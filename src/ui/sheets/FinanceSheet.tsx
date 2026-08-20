import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import {
  Button,
  Card,
  ListRow,
  MoneyText,
  SectionHeader,
  SegmentedControl,
  TextField,
} from '@/design-system';
import { fmtMoney, fmtMoneyCompact } from '@/engine/format';
import { netWorth } from '@/engine/phases/finance';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { Investments } from '@/types';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

/**
 * Ticket sizes both money pickers offer. Each picker keeps its own selection:
 * one control shared between the investment rows and the loan rows would let an
 * investment ticket chosen at the top of the sheet be spent by a Repay button
 * further down, which is a hundredfold difference with nothing on screen to
 * show it.
 */
const AMOUNTS: readonly number[] = [100, 1000, 10000];

/** The repayment picker's extra chip: as much of the loan as the cash covers. */
const REPAY_ALL = 'all';

const INVEST_KINDS: readonly (keyof Investments)[] = ['savings', 'index', 'crypto'];

const cashRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
};

const netWorthStyle: CSSProperties = {
  paddingTop: 'var(--sp-1)',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const investRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
  minHeight: 44,
  padding: 'var(--sp-1) 0',
};

const balanceStyle: CSSProperties = {
  display: 'block',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
};

const loanRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--sp-2)',
};

const borrowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const quietStyle: CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-subhead)',
};

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Cash on hand, the investment pots, outstanding loans and the bank counter. */
export function FinanceSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  const [investAmount, setInvestAmount] = useState(100);
  const [repayAmount, setRepayAmount] = useState<number | typeof REPAY_ALL>(100);
  const [borrow, setBorrow] = useState('');
  if (game === null) {
    return null;
  }

  const c = game.character;

  /* The store words every refusal and this sheet only shows it: which side of a
     move ran out, and whether a finished life may move money at all, are the
     engine's rules to state, not this sheet's to guess at. */
  const refused = (reason: string): void => {
    useUiStore.getState().addToast({ icon: '🚫', title: reason });
  };

  const depositNow = (kind: keyof Investments): void => {
    const r = useGameStore.getState().deposit(kind, investAmount);
    if (!r.ok) {
      refused(r.reason);
    }
  };

  const withdrawNow = (kind: keyof Investments): void => {
    const r = useGameStore.getState().withdraw(kind, investAmount);
    if (!r.ok) {
      refused(r.reason);
    }
  };

  const repayNow = (loanId: string, principal: number): void => {
    const before = c.money;
    const ticket = repayAmount === REPAY_ALL ? principal : repayAmount;
    const r = useGameStore.getState().repayLoan(loanId, ticket);
    if (!r.ok) {
      refused(r.reason);
      return;
    }
    // The ticket is a ceiling, not the sum that moved: the engine caps a payment
    // at the cash on hand and at what is left of the loan, so the only honest
    // number to report is the one that actually left the wallet.
    const after = useGameStore.getState().game?.character.money ?? before;
    useUiStore.getState().addToast({ icon: '✅', title: `Paid ${fmtMoney(before - after)}.` });
  };

  /* The sum rides on the button as well as in the picker above it: a long loan
     list scrolls the picker out of view, and a repayment is the one money tap in
     this sheet with no confirmation step in front of it. */
  const repayLabel = `Repay ${repayAmount === REPAY_ALL ? 'All' : fmtMoneyCompact(repayAmount)}`;

  const borrowNow = (): void => {
    // Every amount the app shows is comma-grouped, so the field has to read one
    // back: `Number.parseInt` stops at the separator and would borrow $10 for
    // "10,000" without a word. Anything else is refused, never truncated.
    const cleaned = borrow.replace(/[,\s]/g, '');
    const wanted = /^\d+(\.\d+)?$/.test(cleaned) ? Math.round(Number(cleaned)) : Number.NaN;
    if (Number.isNaN(wanted)) {
      useUiStore.getState().addToast({ icon: '🏦', title: 'Enter an amount to borrow.' });
      return;
    }
    const r = useGameStore.getState().takeLoan(wanted);
    if (!r.ok) {
      useUiStore.getState().addToast({ icon: '🏦', title: r.reason ?? 'The bank refused.' });
      return;
    }
    setBorrow('');
  };

  return (
    <SheetChrome id="finance" title="Money">
      <Card>
        <div style={cashRowStyle}>
          <span>Cash</span>
          <MoneyText value={c.money} />
        </div>
        <div style={netWorthStyle}>Net worth {fmtMoney(netWorth(game))}</div>
      </Card>
      <div>
        <SectionHeader>Investments</SectionHeader>
        <Card>
          <SegmentedControl
            options={AMOUNTS.map((n) => ({
              id: String(n),
              label: fmtMoneyCompact(n),
              testId: `fin-amount-${String(n)}`,
            }))}
            value={String(investAmount)}
            onChange={(id) => {
              setInvestAmount(Number.parseInt(id, 10));
            }}
          />
          {INVEST_KINDS.map((kind) => (
            <div key={kind} style={investRowStyle}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>{capitalize(kind)}</span>
                <span style={balanceStyle}>
                  <MoneyText compact value={c.investments[kind]} />
                </span>
              </span>
              <Button
                size="sm"
                testId={`fin-deposit-${kind}`}
                onClick={() => {
                  depositNow(kind);
                }}
              >
                Deposit
              </Button>
              <Button
                size="sm"
                testId={`fin-withdraw-${kind}`}
                onClick={() => {
                  withdrawNow(kind);
                }}
              >
                Withdraw
              </Button>
            </div>
          ))}
        </Card>
      </div>
      <div>
        <SectionHeader>Loans</SectionHeader>
        {c.loans.length === 0 ? (
          <div style={quietStyle}>Debt-free.</div>
        ) : (
          <Card>
            <SegmentedControl
              options={[
                ...AMOUNTS.map((n) => ({
                  id: String(n),
                  label: fmtMoneyCompact(n),
                  testId: `fin-repay-amount-${String(n)}`,
                })),
                { id: REPAY_ALL, label: 'All', testId: `fin-repay-amount-${REPAY_ALL}` },
              ]}
              value={String(repayAmount)}
              onChange={(id) => {
                setRepayAmount(id === REPAY_ALL ? REPAY_ALL : Number.parseInt(id, 10));
              }}
            />
            {c.loans.map((loan) => (
              <div key={loan.id} style={loanRowStyle}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <ListRow
                    testId={`loan-row-${loan.id}`}
                    title={`${capitalize(loan.kind)} loan`}
                    subtitle={`${(loan.apr * 100).toFixed(1)}% APR`}
                    value={<MoneyText compact value={loan.principal} />}
                  />
                </div>
                <Button
                  size="sm"
                  testId={`loan-repay-${loan.id}`}
                  onClick={() => {
                    repayNow(loan.id, loan.principal);
                  }}
                >
                  {repayLabel}
                </Button>
              </div>
            ))}
          </Card>
        )}
      </div>
      <div>
        <SectionHeader>Borrow</SectionHeader>
        <Card>
          <div style={borrowStyle}>
            <TextField
              value={borrow}
              onChange={setBorrow}
              placeholder="Amount"
              testId="fin-borrow-amount"
            />
            <Button fullWidth testId="fin-borrow" onClick={borrowNow}>
              Take loan
            </Button>
          </div>
        </Card>
      </div>
    </SheetChrome>
  );
}
