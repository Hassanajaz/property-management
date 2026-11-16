import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { formatPence, rentReview, today } from '@lettly/core';
import { useLoad } from '../../src/hooks';
import { useSession } from '../../src/session';
import { StatusBadge, styles } from '../../src/ui';

/** Rent review board: when each tenancy's rent can next be increased, and by when notice must be served. */
export default function RentReviews() {
  const { api } = useSession();
  const { data, loading, error, reload } = useLoad(async () => {
    const [tenancies, properties] = await Promise.all([api.listTenancies(), api.listProperties()]);
    return { tenancies, properties };
  });
  const now = today();

  const rows = (data?.tenancies ?? [])
    .filter((t) => t.status === 'active')
    .map((tenancy) => {
      const property = data!.properties.find((p) => p.id === tenancy.propertyId);
      return property ? { tenancy, review: rentReview(property.nation, tenancy.rentLastChangedOn ?? tenancy.startDate, now) } : null;
    })
    .filter((row) => row !== null)
    .sort((a, b) => a.review.serveNoticeBy.localeCompare(b.review.serveNoticeBy));

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.muted}>
        Rent can usually be increased no more than once every 12 months, with a notice period that depends on the nation. Dates run from when each rent last changed (record a change on the tenancy's rent statement). Check the current rules and use the official form before serving a notice.
      </Text>

      {rows.map(({ tenancy, review }) => (
        <View key={tenancy.id} style={styles.card}>
          <StatusBadge status={review.canServeNow ? 'due_soon' : 'valid'} label={review.canServeNow ? 'Notice can be served now' : `Notice window opens ${review.serveNoticeBy}`} />
          <Text style={styles.h2}>{tenancy.propertyAddress}</Text>
          <Text style={styles.body}>
            {tenancy.tenantNames.join(' and ')} · {formatPence(tenancy.rentAmountPence)} {tenancy.rentFrequency.replace('_', ' ')}
          </Text>
          <Text style={styles.muted}>Earliest date a new rent can start: {review.earliestEffectiveDate}</Text>
          <Text style={styles.muted}>
            Notice needed: {review.noticeMonths} months · {review.route}
          </Text>
        </View>
      ))}
      {data && rows.length === 0 ? <Text style={styles.muted}>No current tenancies.</Text> : null}
    </ScrollView>
  );
}
