import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import type { LotteryResult, SlotsResult } from '@/content/gambling';
import { Button, Card, EmptyState, MoneyText, SectionHeader, SegmentedControl } from '@/design-system';
import { fmtMoney } from '@/engine/format';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const BLACKJACK_BETS: readonly number[] = [10, 50, 100, 500];
const SLOT_BETS: readonly number[] = [5, 25, 100, 500];

/** Friendly banner text per finished-hand result. */
const RESULT_TEXT: Record<'win' | 'lose' | 'push' | 'blackjack', string> = {
  win: 'You win!',
  lose: 'The house wins.',
  push: 'A push — your stake came back.',
  blackjack: 'Blackjack!',
};

const cardColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
};

const rowBetweenStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
};

const strongStyle: CSSProperties = {
  fontWeight: 600,
};

const handLabelStyle: CSSProperties = {
  color: 'var(--label-2)',
  fontSize: 'var(--fs-footnote)',
  marginBottom: 'var(--sp-1)',
};

const chipRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--sp-1)',
};

const chipStyle: CSSProperties = {
  padding: '2px 8px',
  borderRadius: 'var(--r-sm)',
  background: 'var(--fill-3)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-3)',
};

const bannerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: 'var(--sp-3)',
  borderRadius: 'var(--r-md)',
  background: 'var(--fill-3)',
};

const reelsStyle: CSSProperties = {
  fontSize: 34,
  textAlign: 'center',
  letterSpacing: '0.2em',
};

const centerMetaStyle: CSSProperties = {
  textAlign: 'center',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-subhead)',
};

/** Blackjack, slots and the lottery. */
export function CasinoSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  const casino = useGameStore((s) => s.casino);
  const [blackjackBet, setBlackjackBet] = useState('10');
  const [slotBet, setSlotBet] = useState('5');
  const [slots, setSlots] = useState<SlotsResult | null>(null);
  const [lottery, setLottery] = useState<LotteryResult | null>(null);

  if (game === null) {
    return null;
  }

  const c = game.character;

  if (c.age < 18 || c.prison !== null) {
    return (
      <SheetChrome id="casino" title="Casino">
        <EmptyState icon="🔞" title="The casino is off limits." />
      </SheetChrome>
    );
  }

  /* A table with no cards is not a hand to show. Nothing parks one in `casino`
     any more — a refused bet is turned away before the engine deals, and the
     sidecar gate restores only a dealt hand — but the cards below are rendered
     straight from these arrays, so the guard stays as the cheap backstop it is. */
  const table = casino !== null && casino.player.length > 0 ? casino : null;
  /* `BlackjackTable.payout` is stake-inclusive, while the life feed logs
     `payout - bet` for the same hand, so the banner shows that net instead:
     the two places a player reads one hand have to agree. */
  const handNet = table !== null ? table.payout - table.bet : 0;

  /* Each game answers with the house's own reason for turning a bet down, so
     none of the three has to be inferred here — from an empty table, from a
     reel of blocked signs, or from a price this sheet would otherwise have to
     know — and the table limits stay where they are enforced. */
  const refused = (reason: string): void => {
    useUiStore.getState().addToast({ icon: '🚫', title: reason });
  };

  const deal = (): void => {
    const r = useGameStore.getState().startBlackjack(Number(blackjackBet));
    if (!r.ok) {
      refused(r.reason);
    }
  };

  const spin = (): void => {
    const r = useGameStore.getState().spinSlots(Number(slotBet));
    if (!r.ok) {
      refused(r.reason);
      return;
    }
    setSlots(r.result);
  };

  const buyTicket = (): void => {
    const r = useGameStore.getState().buyLottery();
    if (!r.ok) {
      refused(r.reason);
      return;
    }
    setLottery(r.result);
  };

  const handLine = (label: string, cards: readonly string[], total: number): ReactElement => (
    <div>
      <div style={handLabelStyle}>
        {label} — {total}
      </div>
      <div style={chipRowStyle}>
        {cards.map((card, index) => (
          <span key={`${card}-${String(index)}`} style={chipStyle}>
            {card}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <SheetChrome id="casino" title="Casino">
      <Card>
        <div style={rowBetweenStyle}>
          <span style={strongStyle}>Cash</span>
          <MoneyText value={c.money} />
        </div>
      </Card>

      <div>
        <SectionHeader>Blackjack</SectionHeader>
        <Card>
          {table === null ? (
            <div style={cardColStyle}>
              <SegmentedControl
                options={BLACKJACK_BETS.map((bet) => ({
                  id: String(bet),
                  label: fmtMoney(bet),
                  testId: `casino-bet-${bet}`,
                }))}
                value={blackjackBet}
                onChange={setBlackjackBet}
              />
              <Button variant="tinted" testId="casino-deal" fullWidth onClick={deal}>
                Deal
              </Button>
            </div>
          ) : (
            <div style={cardColStyle}>
              {handLine('Dealer', table.dealer, table.dealerTotal)}
              {handLine('You', table.player, table.playerTotal)}
              {!table.done ? (
                <div style={buttonRowStyle}>
                  <Button
                    testId="casino-hit"
                    fullWidth
                    onClick={() => {
                      useGameStore.getState().blackjackHit();
                    }}
                  >
                    Hit
                  </Button>
                  <Button
                    testId="casino-stand"
                    fullWidth
                    onClick={() => {
                      useGameStore.getState().blackjackStand();
                    }}
                  >
                    Stand
                  </Button>
                </div>
              ) : (
                <>
                  <div data-testid="casino-result" style={bannerStyle}>
                    <span style={strongStyle}>
                      {table.result !== undefined ? RESULT_TEXT[table.result] : 'Hand over.'}
                    </span>
                    <span>
                      {handNet > 0 ? '+' : ''}
                      <MoneyText value={handNet} />
                    </span>
                  </div>
                  <Button
                    testId="casino-new-hand"
                    fullWidth
                    onClick={() => {
                      useGameStore.getState().clearCasino();
                    }}
                  >
                    New hand
                  </Button>
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      <div>
        <SectionHeader>Slots</SectionHeader>
        <Card>
          <div style={cardColStyle}>
            <SegmentedControl
              options={SLOT_BETS.map((bet) => ({
                id: String(bet),
                label: fmtMoney(bet),
                testId: `slots-bet-${bet}`,
              }))}
              value={slotBet}
              onChange={setSlotBet}
            />
            <Button testId="slots-spin" fullWidth onClick={spin}>
              Spin
            </Button>
            {slots !== null ? (
              <>
                <div data-testid="slots-reels" style={reelsStyle}>
                  {slots.reels.join(' ')}
                </div>
                <div style={centerMetaStyle}>
                  Paid <MoneyText value={slots.payout} />
                </div>
              </>
            ) : null}
          </div>
        </Card>
      </div>

      <div>
        <SectionHeader>Lottery</SectionHeader>
        <Card>
          <div style={cardColStyle}>
            <Button testId="lottery-buy" fullWidth onClick={buyTicket}>
              Buy ticket — $5
            </Button>
            {lottery !== null ? (
              <div style={centerMetaStyle}>
                {lottery.won ? `You won ${fmtMoney(lottery.prize)}!` : 'No luck this week.'}
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </SheetChrome>
  );
}
