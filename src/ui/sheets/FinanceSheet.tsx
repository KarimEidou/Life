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

/** Ticket sizes the shared amount picker offers deposits, withdrawals and repayments. */
const AMOUNTS: readonly number[] = [100, 1000, 10000];

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
  const [amount, setAmount] = useState(100);
  const [borrow, setBorrow] = useState('');
  if (game === null) {
    return null;
  }

  const c = game.character;

  const depositNow = (kind: keyof Investments): void => {
    const ok = useGameStore.getState().deposit(kind, amount);
    if (!ok) {
      useUiStore.getState().addToast({ icon: '🚫', title: "You don't have that much." });
    }
  };

  const withdrawNow = (kind: keyof Investments): void => {
    const ok = useGameStore.getState().withdraw(kind, amount);
    if (!ok) {
      useUiStore.getState().addToast({ icon: '🚫', title: 'Not that much invested.' });
    }
  };

  const borrowNow = (): void => {
    const wanted = Number.parseInt(borrow, 10);
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
            value={String(amount)}
            onChange={(id) => {
              setAmount(Number.parseInt(id, 10));
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
                    useGameStore.getState().repayLoan(loan.id, amount);
                  }}
                >
                  Repay
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
