import type { AssetDef, ContentPack } from '@/types';

/**
 * The buy list: twelve places to live and twelve things to drive.
 *
 * Terms are uniform per family and set here rather than per row, because the
 * finance phase reads them every single year: property carries light upkeep and
 * appreciates, a vehicle costs a tenth of that to keep and loses value from the
 * moment it leaves the lot. Only the price and the label change down the list,
 * so a ladder from a $2,000 beater to a $5,000,000 villa stays readable.
 *
 * Ids are load-bearing beyond this file: the achievements pack counts owned
 * assets by the `prop-` and `veh-` prefixes, and the finance phase gates
 * property at 18 and vehicles at 16 on its own, so the `minAge` here must agree
 * with it.
 */

/** Property: 1.5% of value a year to keep, 3% a year in appreciation. */
const PROPERTY_MIN_AGE = 18;
const PROPERTY_UPKEEP = 0.015;
const PROPERTY_APPRECIATION = 0.03;

/** Vehicles: 5% of value a year to keep, and 10% a year straight back down. */
const VEHICLE_MIN_AGE = 16;
const VEHICLE_UPKEEP = 0.05;
const VEHICLE_APPRECIATION = -0.1;

function property(id: string, label: string, icon: string, price: number): AssetDef {
  return {
    id,
    type: 'property',
    label,
    icon,
    price,
    upkeepPct: PROPERTY_UPKEEP,
    apprPct: PROPERTY_APPRECIATION,
    minAge: PROPERTY_MIN_AGE,
  };
}

function vehicle(id: string, label: string, icon: string, price: number): AssetDef {
  return {
    id,
    type: 'vehicle',
    label,
    icon,
    price,
    upkeepPct: VEHICLE_UPKEEP,
    apprPct: VEHICLE_APPRECIATION,
    minAge: VEHICLE_MIN_AGE,
  };
}

/** Cheapest first, so the shop list reads as a ladder without sorting. */
const assets: AssetDef[] = [
  property('prop-studio', 'Studio Apartment', '🏢', 80000),
  property('prop-condo', 'City Condo', '🏬', 160000),
  property('prop-starter-home', 'Starter Home', '🏠', 250000),
  property('prop-suburban', 'Suburban House', '🏡', 400000),
  property('prop-townhouse', 'Townhouse', '🏘️', 550000),
  property('prop-loft', 'Converted Loft', '🌇', 700000),
  property('prop-farmhouse', 'Farmhouse', '🚜', 850000),
  property('prop-beach-cottage', 'Beach Cottage', '🏖️', 1100000),
  property('prop-city-penthouse', 'City Penthouse', '🌆', 2000000),
  property('prop-mountain-lodge', 'Mountain Lodge', '🏔️', 2800000),
  property('prop-mansion', 'Mansion', '🏰', 3800000),
  property('prop-villa', 'Private Villa', '🏝️', 5000000),

  vehicle('veh-beater', 'Rusty Beater', '🛞', 2000),
  vehicle('veh-used-hatch', 'Used Hatchback', '🚗', 6000),
  vehicle('veh-motorcycle', 'Motorcycle', '🏍️', 12000),
  vehicle('veh-sedan', 'Family Sedan', '🚘', 18000),
  vehicle('veh-suv', 'Midsize SUV', '🚙', 32000),
  vehicle('veh-pickup', 'Pickup Truck', '🛻', 38000),
  vehicle('veh-ev', 'Electric Compact', '🔋', 45000),
  vehicle('veh-sports-coupe', 'Sports Coupe', '🏎️', 70000),
  vehicle('veh-camper-van', 'Camper Van', '🚐', 85000),
  vehicle('veh-luxury-sedan', 'Luxury Sedan', '🚖', 110000),
  vehicle('veh-classic-car', 'Classic Convertible', '🚕', 150000),
  vehicle('veh-supercar', 'Supercar', '🚀', 400000),
];

/** Buyable properties and vehicles with their upkeep and appreciation rates. */
export const assetsPack: ContentPack = {
  id: 'assets',
  assets,
};
