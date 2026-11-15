import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { PERSONAL_DOCUMENT_TYPES, TENANT_DOCUMENT_TYPES, isLandlord, type DocumentType } from '@lettly/core';
import { canSeeProperty, canSeeTenancy, formatAddress, visibilityFor } from '../access.ts';
import type { AppEnv } from '../auth.ts';
import { withOrg } from '../db/client.ts';
import { documents, properties } from '../db/schema.ts';
import { env } from '../env.ts';
import { audit } from './portfolio.ts';

const s3 = new S3Client({});
export const documentRoutes = new Hono<AppEnv>();

const LINK_SECONDS = 300;

const TENANT_VISIBLE = TENANT_DOCUMENT_TYPES;

const uploadInput = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().regex(/^(image\/(jpeg|png|heic|webp)|application\/pdf)$/, 'Only photos and PDFs can be uploaded'),
  type: z.string() as z.ZodType<DocumentType>,
  propertyId: z.string().uuid().optional(),
  tenancyId: z.string().uuid().optional(),
});

/**
 * Step 1 of an upload: records the document and returns a short-lived link.
 * The app then sends the file straight to storage with a PUT to that link.
 */
documentRoutes.post('/documents/upload-url', async (c) => {
  const auth = c.get('auth');
  const input = uploadInput.parse(await c.req.json());
  // The landlord can add any document. Tenants can add repair photos only.
  if (!isLandlord(auth.role) && input.type !== 'maintenance_photo') {
    throw new HTTPException(403, { message: 'You can only upload photos for a repair report' });
  }

  const documentId = randomUUID();
  const safeName = input.fileName.replace(/[^\w.\-]+/g, '_');
  const s3Key = `${auth.orgId}/${documentId}/${safeName}`;

  await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);
    if (input.propertyId && !canSeeProperty(v, input.propertyId)) throw new HTTPException(403, { message: 'Not your property' });
    if (input.tenancyId && !canSeeTenancy(v, input.tenancyId)) throw new HTTPException(403, { message: 'Not your tenancy' });
    await tx.insert(documents).values({
      id: documentId,
      orgId: auth.orgId,
      type: input.type,
      fileName: input.fileName,
      contentType: input.contentType,
      s3Key,
      propertyId: input.propertyId,
      tenancyId: input.tenancyId,
      uploadedBy: auth.userId,
    });
  });

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: env.DOCUMENTS_BUCKET, Key: s3Key, ContentType: input.contentType }),
    { expiresIn: LINK_SECONDS },
  );
  return c.json({ documentId, uploadUrl }, 201);
});

/** Documents the signed-in person may see, newest first. */
documentRoutes.get('/documents', async (c) => {
  const auth = c.get('auth');
  const rows = await withOrg(auth.orgId, async (tx) => {
    const v = await visibilityFor(tx, auth);
    const all = await tx.select().from(documents);
    const props = await tx.select().from(properties);
    const addresses = new Map(props.map((p) => [p.id, formatAddress(p)]));
    return all
      .filter((d) => {
        if (isLandlord(auth.role)) return true;
        if (d.uploadedBy === auth.userId) return true;
        const inScope = (d.tenancyId !== null && canSeeTenancy(v, d.tenancyId)) || (d.propertyId !== null && canSeeProperty(v, d.propertyId));
        return inScope && TENANT_VISIBLE.includes(d.type);
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((d) => ({
        id: d.id,
        type: d.type,
        fileName: d.fileName,
        propertyId: d.propertyId,
        tenancyId: d.tenancyId,
        propertyAddress: d.propertyId ? (addresses.get(d.propertyId) ?? null) : null,
        createdAt: d.createdAt.toISOString(),
      }));
  });
  return c.json(rows);
});

/** Returns a short-lived link to view a document, if this person is allowed to see it. */
documentRoutes.get('/documents/:id/download-url', async (c) => {
  const auth = c.get('auth');
  const doc = await withOrg(auth.orgId, async (tx) => {
    const [row] = await tx.select().from(documents).where(eq(documents.id, c.req.param('id')));
    if (!row) throw new HTTPException(404, { message: 'Document not found' });

    let allowed = isLandlord(auth.role) || row.uploadedBy === auth.userId;
    if (!allowed) {
      const v = await visibilityFor(tx, auth);
      const inScope = (row.tenancyId !== null && canSeeTenancy(v, row.tenancyId)) || (row.propertyId !== null && canSeeProperty(v, row.propertyId));
      allowed = inScope && TENANT_VISIBLE.includes(row.type);
    }
    if (!allowed) throw new HTTPException(404, { message: 'Document not found' });

    // Every view of a personal document is recorded.
    if (PERSONAL_DOCUMENT_TYPES.includes(row.type)) await audit(tx, auth, 'document.viewed', 'document', row.id);
    return row;
  });

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.DOCUMENTS_BUCKET, Key: doc.s3Key }), { expiresIn: LINK_SECONDS });
  return c.json({ url });
});
