import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import {
  Button,
  Card,
  EmptyState,
  ListRow,
  ProgressBar,
  SectionHeader,
  Switch,
} from '@/design-system';
import { fmtMoney, fmtMoneyCompact } from '@/engine/format';
import { jobRequirementsMet } from '@/engine/phases/career';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { JobDef } from '@/types';
import { statColor } from '@/ui/lib/feed';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const cardColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const jobTitleStyle: CSSProperties = {
  fontWeight: 600,
};

const jobMetaStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const perfLabelStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
  marginBottom: 'var(--sp-1)',
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-3)',
};

const listGroupStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const unmetStyle: CSSProperties = {
  opacity: 0.55,
};

/** The current job plus every listing the character qualifies for. */
export function OccupationSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  if (game === null) {
    return null;
  }

  const c = game.character;

  if (c.prison !== null) {
    return (
      <SheetChrome id="occupation" title="Occupation">
        <EmptyState icon="🔒" title="You're in prison." />
      </SheetChrome>
    );
  }

  const reg = getRegistry();
  const job = c.job;

  const sorted = [...reg.jobs].sort((a, b) =>
    a.track === b.track ? a.level - b.level : a.track.localeCompare(b.track)
  );
  // The seat already held is not a listing.
  const listings = sorted.filter((def) => job === null || def.id !== job.jobId);
  const partTime = listings.filter((def) => def.isPartTime === true);
  const careers = listings.filter((def) => def.isPartTime !== true);

  const renderJob = (def: JobDef): ReactElement => {
    const met = jobRequirementsMet(game, reg, def);
    return (
      // Unmet listings dim but stay tappable; the tap explains the refusal.
      <div key={def.id} style={met.ok ? undefined : unmetStyle}>
        <ListRow
          testId={`job-row-${def.id}`}
          icon={def.icon}
          title={def.title}
          subtitle={met.ok ? def.track : met.reason}
          value={`${fmtMoneyCompact(def.baseSalary)}/yr`}
          onClick={() => {
            const ui = useUiStore.getState();
            if (!met.ok) {
              ui.addToast({ icon: '🚫', title: met.reason ?? 'Not qualified.' });
              return;
            }
            const r = useGameStore.getState().applyForJob(def.id);
            ui.addToast(
              r.ok
                ? { icon: '💼', title: 'You got the job!' }
                : { icon: '🙅', title: r.reason ?? 'The interview went badly.' }
            );
          }}
        />
      </div>
    );
  };

  return (
    <SheetChrome id="occupation" title="Occupation">
      {job !== null ? (
        <Card>
          <div style={cardColStyle}>
            <div>
              <div style={jobTitleStyle}>{job.title}</div>
              <div style={jobMetaStyle}>
                {fmtMoney(job.salary)}/yr · {job.years} yr in role
              </div>
            </div>
            <div>
              <div style={perfLabelStyle}>Performance</div>
              <ProgressBar value={job.performance} color={statColor(job.performance)} />
            </div>
            <Switch
              label="Work hard"
              testId="job-workhard"
              checked={job.workHard}
              onChange={(on) => {
                useGameStore.getState().setWorkHard(on);
              }}
            />
            <div style={buttonRowStyle}>
              <Button
                testId="job-raise"
                fullWidth
                onClick={() => {
                  // One field name for one idea: the answer to a raise is prose
                  // either way, and the store hands it back under `ok`.
                  const r = useGameStore.getState().askForRaise();
                  useUiStore.getState().addToast(
                    r.ok
                      ? { icon: '💸', title: r.text ?? 'Your boss said yes.' }
                      : { icon: '🙅', title: r.reason }
                  );
                }}
              >
                Ask for a raise
              </Button>
              <Button
                variant="destructive"
                testId="job-quit"
                fullWidth
                onClick={() => {
                  const r = useGameStore.getState().quitJob();
                  if (!r.ok) {
                    useUiStore.getState().addToast({ icon: '🚫', title: r.reason });
                  }
                }}
              >
                Quit job
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {partTime.length > 0 ? (
        <div>
          <SectionHeader>Part-time</SectionHeader>
          <div style={listGroupStyle}>{partTime.map(renderJob)}</div>
        </div>
      ) : null}

      {careers.length > 0 ? (
        <div>
          <SectionHeader>Careers</SectionHeader>
          <div style={listGroupStyle}>{careers.map(renderJob)}</div>
        </div>
      ) : null}
    </SheetChrome>
  );
}
