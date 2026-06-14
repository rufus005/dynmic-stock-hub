import { describe, expect, it } from 'vitest';
import { createSeedPricing, createSalePurchasePriceSnapshot, getPurchasePrice, getSalePurchasePrice } from './pricing';

describe('dynamic product pricing helpers', () => {
  it('returns active pricing and falls back to 0 when a price is missing or inactive', () => {
    const pricing = [
      { id: 'active', product: 'JUMBO', color: 'Ivory', size: '5', purchasePrice: 3600, isActive: true },
      { id: 'inactive', product: 'JUMBO', color: 'Ivory', size: '4', purchasePrice: 3100, isActive: false },
    ];

    expect(getPurchasePrice('JUMBO', 'Ivory', '5', pricing)).toBe(3600);
    expect(getPurchasePrice('JUMBO', 'Ivory', '4', pricing)).toBe(0);
    expect(getPurchasePrice('JUMBO', 'Ivory', '3', pricing)).toBe(0);
  });

  it('uses sale purchase price snapshots before current pricing fallback', () => {
    const pricing = [
      { id: 'new', product: 'JUMBO', color: 'Ivory', size: '5', purchasePrice: 4200, isActive: true },
    ];

    expect(getSalePurchasePrice({ product: 'JUMBO', color: 'Ivory', shelfSize: '5', purchasePrice: 3600 }, pricing)).toBe(3600);
    expect(getSalePurchasePrice({ product: 'JUMBO', color: 'Ivory', shelfSize: '5', purchasePriceSnapshot: 3700 }, pricing)).toBe(3700);
    expect(getSalePurchasePrice({ product: 'JUMBO', color: 'Ivory', shelfSize: '5' }, pricing)).toBe(4200);
    expect(getSalePurchasePrice({ product: 'JUMBO', color: 'Grey', shelfSize: '5' }, pricing)).toBe(0);
  });

  it('keeps old sale report price after admin price edit and uses updated price for new sales', () => {
    const oldPricing = [
      { id: '5', product: 'JUMBO', color: 'Ivory', size: '5', purchasePrice: 3600, isActive: true },
    ];
    const updatedPricing = [
      { id: '5', product: 'JUMBO', color: 'Ivory', size: '5', purchasePrice: 5000, isActive: true },
    ];
    const saleInput = { product: 'JUMBO', color: 'Ivory', shelfSize: '5' };

    const oldSale = {
      ...saleInput,
      ...createSalePurchasePriceSnapshot(saleInput, oldPricing, '2026-06-14T09:00:00.000Z'),
    };
    const newSale = {
      ...saleInput,
      ...createSalePurchasePriceSnapshot(saleInput, updatedPricing, '2026-06-14T10:00:00.000Z'),
    };

    expect(oldSale).toMatchObject({
      purchasePrice: 3600,
      purchasePriceSnapshot: 3600,
      purchasePriceSource: 'pricing_table',
      purchasePriceLockedAt: '2026-06-14T09:00:00.000Z',
    });
    expect(newSale.purchasePrice).toBe(5000);
    expect(getSalePurchasePrice(oldSale, updatedPricing)).toBe(3600);
    expect(getSalePurchasePrice(newSale, updatedPricing)).toBe(5000);
  });

  it('creates seeded Firebase pricing records with active status and timestamps', () => {
    const seeded = createSeedPricing('2026-06-14T00:00:00.000Z');

    expect(seeded).toHaveLength(52);
    expect(seeded[0]).toMatchObject({
      id: '1',
      product: 'JUMBO',
      color: 'Coffee-Brown',
      size: '5',
      purchasePrice: 3600,
      isActive: true,
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    });
  });
});
