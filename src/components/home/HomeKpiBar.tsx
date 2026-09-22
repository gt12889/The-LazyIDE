/* HomeKpiBar — full-width KPI summary bar for the Home dashboard.
   Reuses MetricTile, KpiRow, WindowSelector, useUsageMetrics.
   Shows: tokens, cost, missions done, brain tokens saved.
   Self-contained: manages its own time window state.
*/

import { useState } from 'react';
import { useI18n } from '../../i18n';
import {
  KpiRow,
  MetricTile,
  WindowSelector,
  useUsageMetrics,
  formatTokens,
  formatCost,
} from '../metrics';
import type { UsageWindow } from '../../lib/models/usageHistory';

export function HomeKpiBar() {
  const { t } = useI18n();
  const [timeWindow, setTimeWindow] = useState<UsageWindow>('today');
  const m = useUsageMetrics(timeWindow);

  return (
    <section>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <h2
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.3)',
            margin: 0,
          }}
        >
          {t('metrics.bannerTitle')}
        </h2>
        <WindowSelector value={timeWindow} onChange={setTimeWindow} />
      </div>
      <KpiRow>
        <MetricTile
          label={t('metrics.tokens')}
          value={formatTokens(m.totalTokens)}
          sub={t('metrics.inOut')}
          sparkline={m.tokenSparkline}
          sparklineColor="#7C5CFF"
        />
        <MetricTile
          label={t('metrics.cost')}
          value={formatCost(m.costUsd)}
          sparkline={m.costSparkline}
          sparklineColor="#FFC76B"
        />
        <MetricTile
          label={t('metrics.missions')}
          value={String(m.missionsCompleted)}
          sub={t('metrics.missionsDone')}
          accent
          sparklineColor="#66E27A"
        />
        <MetricTile
          label={t('metrics.brainSaved')}
          value={formatTokens(m.brainTokensSaved)}
          sub={t('metrics.vsRawContext')}
          accent
          sparklineColor="#66E27A"
        />
      </KpiRow>
    </section>
  );
}
