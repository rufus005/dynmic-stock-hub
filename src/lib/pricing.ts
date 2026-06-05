export interface ProductPricing {
  id: string;
  product: string;
  color: string;
  size: string;
  purchasePrice: number;
}

// Static pricing data - can be extended with backend integration later
export const PRODUCT_PRICING: ProductPricing[] = [
  // ================= JUMBO =================
  // Coffee-Brown
  { id: '1', product: 'JUMBO', color: 'Coffee-Brown', size: '5', purchasePrice: 3600 },
  { id: '2', product: 'JUMBO', color: 'Coffee-Brown', size: '4', purchasePrice: 3100 },
  { id: '3', product: 'JUMBO', color: 'Coffee-Brown', size: '3', purchasePrice: 2600 },
  { id: '4', product: 'JUMBO', color: 'Coffee-Brown', size: '2', purchasePrice: 2100 },
  // Ivory
  { id: '5', product: 'JUMBO', color: 'Ivory', size: '5', purchasePrice: 3600 },
  { id: '6', product: 'JUMBO', color: 'Ivory', size: '4', purchasePrice: 3100 },
  { id: '7', product: 'JUMBO', color: 'Ivory', size: '3', purchasePrice: 2600 },
  { id: '8', product: 'JUMBO', color: 'Ivory', size: '2', purchasePrice: 2100 },
  // Coffee-White
  { id: '9', product: 'JUMBO', color: 'Coffee-White', size: '5', purchasePrice: 3600 },
  { id: '10', product: 'JUMBO', color: 'Coffee-White', size: '4', purchasePrice: 3100 },
  { id: '11', product: 'JUMBO', color: 'Coffee-White', size: '3', purchasePrice: 2600 },
  { id: '12', product: 'JUMBO', color: 'Coffee-White', size: '2', purchasePrice: 2100 },
  // Grey-White
  { id: '13', product: 'JUMBO', color: 'Grey-White', size: '5', purchasePrice: 3600 },
  { id: '14', product: 'JUMBO', color: 'Grey-White', size: '4', purchasePrice: 3100 },
  { id: '15', product: 'JUMBO', color: 'Grey-White', size: '3', purchasePrice: 2600 },
  { id: '16', product: 'JUMBO', color: 'Grey-White', size: '2', purchasePrice: 2100 },
  // Grey
  { id: '17', product: 'JUMBO', color: 'Grey', size: '5', purchasePrice: 3600 },
  { id: '18', product: 'JUMBO', color: 'Grey', size: '4', purchasePrice: 3100 },
  { id: '19', product: 'JUMBO', color: 'Grey', size: '3', purchasePrice: 2600 },
  { id: '20', product: 'JUMBO', color: 'Grey', size: '2', purchasePrice: 2100 },

  // ================= PREMIUM =================
  { id: '21', product: 'PREMIUM', color: 'Full-Brown', size: '5', purchasePrice: 5250 },
  { id: '22', product: 'PREMIUM', color: 'Full-Brown', size: '4', purchasePrice: 4750 },
  { id: '23', product: 'PREMIUM', color: 'Full-Brown', size: '3', purchasePrice: 0 },
  { id: '24', product: 'PREMIUM', color: 'Full-Brown', size: '2', purchasePrice: 0 },
  { id: '25', product: 'PREMIUM', color: 'Beige', size: '5', purchasePrice: 5250 },
  { id: '26', product: 'PREMIUM', color: 'Beige', size: '4', purchasePrice: 4750 },
  { id: '27', product: 'PREMIUM', color: 'Beige', size: '3', purchasePrice: 0 },
  { id: '28', product: 'PREMIUM', color: 'Beige', size: '2', purchasePrice: 0 },
  { id: '29', product: 'PREMIUM', color: 'Coffee-White', size: '5', purchasePrice: 5250 },
  { id: '30', product: 'PREMIUM', color: 'Coffee-White', size: '4', purchasePrice: 4750 },
  { id: '31', product: 'PREMIUM', color: 'Coffee-White', size: '3', purchasePrice: 0 },
  { id: '32', product: 'PREMIUM', color: 'Coffee-White', size: '2', purchasePrice: 0 },
  { id: '33', product: 'PREMIUM', color: 'Grey-White', size: '5', purchasePrice: 5250 },
  { id: '34', product: 'PREMIUM', color: 'Grey-White', size: '4', purchasePrice: 4750 },
  { id: '35', product: 'PREMIUM', color: 'Grey-White', size: '3', purchasePrice: 0 },
  { id: '36', product: 'PREMIUM', color: 'Grey-White', size: '2', purchasePrice: 0 },

  // ================= DOUBLE DECKOR =================
  { id: '37', product: 'DOUBLE DECKOR', color: 'Full Brown', size: '5', purchasePrice: 7500 },
  { id: '38', product: 'DOUBLE DECKOR', color: 'Full Brown', size: '4', purchasePrice: 6500 },
  { id: '39', product: 'DOUBLE DECKOR', color: 'Full Brown', size: '3', purchasePrice: 5300 },
  { id: '40', product: 'DOUBLE DECKOR', color: 'Full Brown', size: '2', purchasePrice: 4200 },
  { id: '41', product: 'DOUBLE DECKOR', color: 'Coffee Beige', size: '5', purchasePrice: 7500 },
  { id: '42', product: 'DOUBLE DECKOR', color: 'Coffee Beige', size: '4', purchasePrice: 6500 },
  { id: '43', product: 'DOUBLE DECKOR', color: 'Coffee Beige', size: '3', purchasePrice: 5300 },
  { id: '44', product: 'DOUBLE DECKOR', color: 'Coffee Beige', size: '2', purchasePrice: 4200 },
  { id: '45', product: 'DOUBLE DECKOR', color: 'Gray-White', size: '5', purchasePrice: 7500 },
  { id: '46', product: 'DOUBLE DECKOR', color: 'Gray-White', size: '4', purchasePrice: 6500 },
  { id: '47', product: 'DOUBLE DECKOR', color: 'Gray-White', size: '3', purchasePrice: 5300 },
  { id: '48', product: 'DOUBLE DECKOR', color: 'Gray-White', size: '2', purchasePrice: 4200 },
  { id: '49', product: 'DOUBLE DECKOR', color: 'Beige', size: '5', purchasePrice: 7500 },
  { id: '50', product: 'DOUBLE DECKOR', color: 'Beige', size: '4', purchasePrice: 6500 },
  { id: '51', product: 'DOUBLE DECKOR', color: 'Beige', size: '3', purchasePrice: 5300 },
  { id: '52', product: 'DOUBLE DECKOR', color: 'Beige', size: '2', purchasePrice: 4200 },
];

export function getPurchasePrice(product: string, color: string, size: string): number {
  const match = PRODUCT_PRICING.find(
    p => p.product === product && p.color === color && p.size === size
  );
  return match?.purchasePrice ?? 0;
}
