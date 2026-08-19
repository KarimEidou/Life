import type { CSSProperties, ReactElement } from 'react';

interface TabBarProps {
  items: { id: string; icon: string; label: string }[];
  activeId?: string;
  onSelect: (id: string) => void;
  /** The big elevated Age button that sits in the middle of the bar. */
  centerAction?: { icon: string; label: string; onPress: () => void; disabled?: boolean };
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-around',
  gap: 'var(--sp-2)',
  padding: 'var(--sp-2) var(--sp-2)',
  background: 'var(--bar-bg)',
};

const itemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  /* Tab items are primary navigation: give each a real thumb target. */
  flex: 1,
  minWidth: 44,
  minHeight: 44,
  padding: 'var(--sp-1)',
  fontSize: 'var(--fs-caption)',
};

/** The bottom tab bar, optionally with the elevated centre action between the tabs. */
export function TabBar({ items, activeId, onSelect, centerAction }: TabBarProps): ReactElement {
  const half = Math.ceil(items.length / 2);
  const left = centerAction === undefined ? items : items.slice(0, half);
  const right = centerAction === undefined ? [] : items.slice(half);

  const renderItem = (item: { id: string; icon: string; label: string }): ReactElement => (
    <button
      key={item.id}
      type="button"
      data-testid={`tab-${item.id}`}
      onClick={() => onSelect(item.id)}
      style={{
        ...itemStyle,
        color: item.id === activeId ? 'var(--c-blue)' : 'var(--label-2)',
      }}
    >
      <span aria-hidden>{item.icon}</span>
      <span>{item.label}</span>
    </button>
  );

  return (
    <div style={barStyle}>
      {left.map(renderItem)}
      {centerAction !== undefined ? (
        <button
          type="button"
          onClick={centerAction.onPress}
          disabled={centerAction.disabled}
          style={{
            ...itemStyle,
            padding: 'var(--sp-2) var(--sp-4)',
            borderRadius: 'var(--r-full)',
            background: 'var(--c-blue)',
            color: '#ffffff',
            opacity: centerAction.disabled === true ? 0.4 : 1,
          }}
        >
          <span aria-hidden>{centerAction.icon}</span>
          <span>{centerAction.label}</span>
        </button>
      ) : null}
      {right.map(renderItem)}
    </div>
  );
}
