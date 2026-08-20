/**
 * The money sheet's two pickers and the one tap that is not confirmed.
 *
 * A single amount used to drive deposits, withdrawals *and* repayments, and its
 * only control sat inside the Investments card: a $10,000 ticket chosen there
 * was what a Repay button further down the sheet spent, a hundredfold
 * difference with nothing on screen to show it. The repayment now carries its
 * own amount, next to the button that spends it, and says what actually left
 * the wallet — which is not the ticket, because the engine caps a payment at
 * the cash on hand and at what is left of the loan.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { Loan } from '@/types';
import { currentGame, startLife } from '@/ui/__tests__/helpers/dom';
import { FinanceSheet } from '@/ui/sheets/FinanceSheet';

/** An adult with cash and one loan, committed through an action as the store tests do. */
function setUpDebtor(money: number, principal = 4000): void {
  startLife(21);
  const c = currentGame().character;
  c.age = 30;
  c.money = money;
  c.loans.push({ id: 'l1', kind: 'personal', principal, apr: 0.09 });
  useGameStore.getState().setStudyHard(false);
  // The boot's own achievement toasts are not what any test here is reading.
  useUiStore.setState({ toasts: [] });
}

function cash(): number {
  return currentGame().character.money;
}

function loans(): Loan[] {
  return currentGame().character.loans;
}

function toastTitles(): string[] {
  return useUiStore.getState().toasts.map((t) => t.title);
}

beforeEach(() => {
  setUpDebtor(5000);
});

describe('FinanceSheet repayments', () => {
  it('spends the repay ticket, not the investment one', () => {
    render(<FinanceSheet />);

    // The mis-set ticket the old shared state would have spent.
    fireEvent.click(screen.getByTestId('fin-amount-10000'));
    fireEvent.click(screen.getByTestId('loan-repay-l1'));

    expect(cash()).toBe(4900);
    expect(loans()[0]?.principal).toBe(3900);
    expect(toastTitles()).toEqual(['Paid $100.']);
  });

  it('names the sum on the button so it is legible where it is spent', () => {
    render(<FinanceSheet />);

    expect(screen.getByTestId('loan-repay-l1')).toHaveTextContent('Repay $100');

    fireEvent.click(screen.getByTestId('fin-repay-amount-10000'));
    expect(screen.getByTestId('loan-repay-l1')).toHaveTextContent('Repay $10K');

    fireEvent.click(screen.getByTestId('fin-repay-amount-all'));
    expect(screen.getByTestId('loan-repay-l1')).toHaveTextContent('Repay All');
  });

  it('moves the repay ticket the picker selects', () => {
    render(<FinanceSheet />);

    fireEvent.click(screen.getByTestId('fin-repay-amount-1000'));
    fireEvent.click(screen.getByTestId('loan-repay-l1'));

    expect(cash()).toBe(4000);
    expect(loans()[0]?.principal).toBe(3000);
    expect(toastTitles()).toEqual(['Paid $1,000.']);
  });

  it('clears the loan in one tap on All, instead of ten taps on a chip', () => {
    render(<FinanceSheet />);

    fireEvent.click(screen.getByTestId('fin-repay-amount-all'));
    fireEvent.click(screen.getByTestId('loan-repay-l1'));

    expect(loans()).toEqual([]);
    expect(cash()).toBe(1000);
    expect(toastTitles()).toEqual(['Paid $4,000.']);
    // With nothing left to repay the whole control goes with the rows.
    expect(screen.queryByTestId('fin-repay-amount-all')).toBeNull();
    expect(screen.getByText('Debt-free.')).toBeInTheDocument();
  });

  it('reports what left the wallet, not the ticket that was asked for', () => {
    setUpDebtor(500);
    render(<FinanceSheet />);

    fireEvent.click(screen.getByTestId('fin-repay-amount-all'));
    fireEvent.click(screen.getByTestId('loan-repay-l1'));

    // Capped by the cash on hand: the loan survives, and the toast says so.
    expect(cash()).toBe(0);
    expect(loans()[0]?.principal).toBe(3500);
    expect(toastTitles()).toEqual(['Paid $500.']);
  });

  it('says why a repayment with an empty wallet did nothing', () => {
    setUpDebtor(0);
    render(<FinanceSheet />);

    fireEvent.click(screen.getByTestId('loan-repay-l1'));

    expect(cash()).toBe(0);
    expect(loans()[0]?.principal).toBe(4000);
    expect(toastTitles()).toEqual(['Nothing to pay with.']);
  });

  it('leaves the investment picker to the investment rows', () => {
    render(<FinanceSheet />);

    fireEvent.click(screen.getByTestId('fin-repay-amount-10000'));
    fireEvent.click(screen.getByTestId('fin-amount-1000'));
    fireEvent.click(screen.getByTestId('fin-deposit-savings'));

    expect(currentGame().character.investments.savings).toBe(1000);
    expect(cash()).toBe(4000);
    // The repay ticket is still the one the repay picker holds.
    expect(screen.getByTestId('loan-repay-l1')).toHaveTextContent('Repay $10K');
  });
});
