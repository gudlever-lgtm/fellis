/**
 * Currency formatting utility for fellis.eu
 * All prices are displayed in EUR using de-DE locale.
 * de-DE formats as: 1.234,56 €
 */

export const formatPrice = (amount) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount)
