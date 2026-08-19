import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Button, Card, ListRow, SectionHeader, Switch } from '@/design-system';
import { fmtMoneyCompact } from '@/engine/format';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { EdLevel, SchoolDef } from '@/types';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

/** Display name for the highest level completed. */
const LEVEL_LABEL: Record<EdLevel, string> = {
  none: 'No schooling',
  primary: 'Primary school',
  middle: 'Middle school',
  high: 'High school',
  university: 'University',
  postgrad: 'Postgraduate',
};

const cardColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const captionStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const titleStyle: CSSProperties = {
  fontWeight: 600,
};

const listGroupStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderRadius: 'var(--r-lg)',
  overflow: 'hidden',
};

const majorIndentStyle: CSSProperties = {
  paddingLeft: 'var(--sp-5)',
};

/** Current schooling plus the schools that can be applied to. */
export function EducationSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  // Which school's major list is unfolded; hooks run before the null gate.
  const [expanded, setExpanded] = useState<string | null>(null);
  if (game === null) {
    return null;
  }

  const reg = getRegistry();
  const ed = game.character.education;

  // Widened lookup: a save can name a school the registry no longer carries.
  const schoolsById: Record<string, SchoolDef | undefined> = reg.schoolsById;
  const enrolledDef = ed.enrolledIn !== undefined ? schoolsById[ed.enrolledIn] : undefined;

  const applyable = reg.schools.filter(
    (school) => school.level === 'university' || school.level === 'postgrad'
  );

  /* Every major a degree can actually be earned in: `applyToSchool` writes
     `education.major` from a university's list and from nowhere else, so a
     postgrad programme that accepts all of them turns nobody away and is not
     worth spelling out in a row subtitle. */
  const taught = new Set(
    reg.schools.flatMap((school) => (school.level === 'university' ? (school.majors ?? []) : []))
  );

  const apply = (schoolId: string, major?: string): void => {
    const r = useGameStore.getState().applyToSchool(schoolId, major);
    useUiStore
      .getState()
      .addToast(
        r.ok
          ? { icon: '🎓', title: 'You enrolled.' }
          : { icon: '🙅', title: r.reason ?? 'Your application was rejected.' }
      );
  };

  return (
    <SheetChrome id="education" title="Education">
      <Card>
        <div style={cardColStyle}>
          <div>
            <div style={captionStyle}>Highest completed</div>
            <div style={titleStyle}>{LEVEL_LABEL[ed.level]}</div>
          </div>
          {enrolledDef !== undefined ? (
            <>
              <div>
                <div style={titleStyle}>{enrolledDef.label}</div>
                <div style={captionStyle}>
                  Year {ed.year + 1} of {enrolledDef.years} · GPA {ed.gpa.toFixed(1)}
                </div>
              </div>
              <Switch
                label="Study hard"
                testId="edu-studyhard"
                checked={ed.studyHard}
                onChange={(on) => {
                  useGameStore.getState().setStudyHard(on);
                }}
              />
              <Button
                variant="destructive"
                testId="edu-dropout"
                fullWidth
                onClick={() => {
                  useGameStore.getState().dropOut();
                }}
              >
                Drop out
              </Button>
            </>
          ) : null}
        </div>
      </Card>

      <div>
        <SectionHeader>Apply</SectionHeader>
        <div style={listGroupStyle}>
          {applyable.map((school) => {
            /* `SchoolDef.majors` is overloaded by level and `applyToSchool` reads
               it both ways: a university offers them — it validates the picked
               major against the list and records it — while a postgrad programme
               lists the undergrad majors it accepts, matches them against the
               degree already held and discards any major passed in. So only a
               university may show them as a chooser; a postgrad row applies in
               one tap and names its list as the entry requirement it is. */
            const majors = school.majors ?? [];
            const chooseMajor = school.level === 'university' && majors.length > 0;
            const isOpen = expanded === school.id;
            const gpaNote = school.minGpa !== undefined ? ` · GPA ${school.minGpa}+` : '';
            const acceptsAll =
              taught.size > 0 && [...taught].every((major) => majors.includes(major));
            const acceptsNote =
              chooseMajor || majors.length === 0
                ? ''
                : ` · Accepts ${acceptsAll ? 'any major' : majors.join(', ')}`;
            return (
              <div key={school.id}>
                <ListRow
                  testId={`school-row-${school.id}`}
                  title={school.label}
                  subtitle={`${fmtMoneyCompact(school.tuitionPerYear)}/yr${gpaNote}${acceptsNote}`}
                  chevron={chooseMajor}
                  onClick={() => {
                    if (chooseMajor) {
                      setExpanded(isOpen ? null : school.id);
                    } else {
                      apply(school.id);
                    }
                  }}
                />
                {chooseMajor && isOpen
                  ? majors.map((major) => (
                      <div key={major} style={majorIndentStyle}>
                        <ListRow
                          testId={`major-${school.id}-${major}`}
                          title={major}
                          onClick={() => {
                            apply(school.id, major);
                          }}
                        />
                      </div>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      </div>
    </SheetChrome>
  );
}
