import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import { Alert, Card, ListRow, MoneyText, SectionHeader } from '@/design-system';
import { clampMoney } from '@/engine/effects';
import { fmtMoney, fmtMoneyCompact } from '@/engine/format';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { AssetDef, OwnedAsset } from '@/types';
import { SheetChrome } from '@/ui/sheets/SheetChrome';

const quietStyle: CSSProperties = {
  padding: 'var(--sp-2) var(--sp-4)',
  color: 'var(--label-2)',
  fontSize: 'var(--fs-subhead)',
};

/**
 * Mirrors `RESALE_RATE` in `src/engine/phases/finance.ts` — the share of an
 * asset's value a sale actually fetches — which is module-private there. The
 * confirmation is the only screen where the player decides, so it has to quote
 * what `sellAsset` pays, not the book value on the row.
 */
const RESALE_RATE = 0.9;

/** What `sellAsset` hands over for an asset, before any secured loan is settled. */
function proceedsOf(asset: OwnedAsset): number {
  return clampMoney(asset.value * RESALE_RATE);
}

/** Owned properties and vehicles, plus everything on the market. */
export function AssetsSheet(): ReactElement | null {
  const game = useGameStore((s) => s.game);
  const [sellTarget, setSellTarget] = useState<OwnedAsset | null>(null);
  const [buyTarget, setBuyTarget] = useState<AssetDef | null>(null);
  if (game === null) {
    return null;
  }

  const reg = getRegistry();
  const c = game.character;
  const properties = reg.assets.filter((def) => def.type === 'property');
  const vehicles = reg.assets.filter((def) => def.type === 'vehicle');

  const sell = (asset: OwnedAsset): void => {
    setSellTarget(null);
    const proceeds = proceedsOf(asset);
    useGameStore.getState().sellAsset(asset.id);
    /* `sellAsset` returns nothing and refuses silently on a finished life, so
       the asset going is the only evidence the sale happened. */
    const after = useGameStore.getState().game?.character.assets ?? [];
    if (!after.some((held) => held.id === asset.id)) {
      const title = `Sold ${asset.label} for ${fmtMoney(proceeds)}.`;
      useUiStore.getState().addToast({ icon: '💵', title });
    }
  };

  const sellMessage = (asset: OwnedAsset): string => {
    /* A loan secured against the asset is settled out of the proceeds before any
       of it reaches the balance, so the player has to see both numbers. */
    const owed = c.loans.find((loan) => loan.assetId === asset.id)?.principal ?? 0;
    const owedNote = owed > 0 ? `, less ${fmtMoney(owed)} still owed on it` : '';
    return `Sells for ${fmtMoney(proceedsOf(asset))}${owedNote}.`;
  };

  const buy = (def: AssetDef, withLoan: boolean): void => {
    setBuyTarget(null);
    const r = useGameStore.getState().buyAsset(def.id, withLoan);
    if (!r.ok) {
      useUiStore.getState().addToast({ icon: '🚫', title: r.reason ?? 'You cannot buy that.' });
    } else {
      useUiStore.getState().addToast({ icon: def.icon, title: `Purchased ${def.label}.` });
    }
  };

  const marketGroup = (label: string, defs: AssetDef[]): ReactElement => (
    <div>
      <SectionHeader>{label}</SectionHeader>
      <Card>
        {defs.map((def) => (
          <ListRow
            key={def.id}
            testId={`asset-market-${def.id}`}
            icon={def.icon}
            title={def.label}
            value={fmtMoneyCompact(def.price)}
            onClick={() => {
              setBuyTarget(def);
            }}
          />
        ))}
      </Card>
    </div>
  );

  return (
    <SheetChrome id="assets" title="Assets">
      <div>
        <SectionHeader>Owned</SectionHeader>
        {c.assets.length === 0 ? (
          <div style={quietStyle}>You own nothing yet.</div>
        ) : (
          <Card>
            {c.assets.map((asset) => (
              <ListRow
                key={asset.id}
                testId={`asset-owned-${asset.id}`}
                title={asset.label}
                subtitle={`Bought ${String(asset.yearBought)} for ${fmtMoneyCompact(asset.paid)}`}
                value={<MoneyText compact value={asset.value} />}
                onClick={() => {
                  setSellTarget(asset);
                }}
              />
            ))}
          </Card>
        )}
      </div>
      <SectionHeader>Market</SectionHeader>
      {marketGroup('Properties', properties)}
      {marketGroup('Vehicles', vehicles)}
      {sellTarget !== null ? (
        <Alert
          open
          title={`Sell ${sellTarget.label}?`}
          message={sellMessage(sellTarget)}
          actions={[
            {
              label: 'Sell',
              style: 'destructive',
              testId: 'alert-action-sell',
              onPress: () => {
                sell(sellTarget);
              },
            },
            {
              label: 'Cancel',
              style: 'cancel',
              onPress: () => {
                setSellTarget(null);
              },
            },
          ]}
        />
      ) : null}
      {buyTarget !== null ? (
        <Alert
          open
          title={`Buy ${buyTarget.label}?`}
          message={fmtMoney(buyTarget.price)}
          actions={[
            {
              label: 'Buy outright',
              testId: 'alert-action-buy',
              onPress: () => {
                buy(buyTarget, false);
              },
            },
            {
              label: 'Finance',
              testId: 'alert-action-finance',
              onPress: () => {
                buy(buyTarget, true);
              },
            },
            {
              label: 'Cancel',
              style: 'cancel',
              onPress: () => {
                setBuyTarget(null);
              },
            },
          ]}
        />
      ) : null}
    </SheetChrome>
  );
}
