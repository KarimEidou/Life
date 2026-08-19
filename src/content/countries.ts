import type { ContentPack, CountryDef } from '@/types';

/**
 * The ten playable countries.
 *
 * `costMult` scales what living there costs (rent, upkeep, treatment, tuition),
 * `taxMult` scales the income tax the finance phase withholds, and
 * `visaDifficulty` (0..1) is how hard it is to emigrate *into* the country —
 * rich, popular destinations gate hardest.
 *
 * Ids are the shared two-letter vocabulary the rest of the content packs key
 * off. Nothing repairs a save that still names an id retired from this list:
 * `findCountry` simply misses, so the finance phase charges neutral 1.0 cost
 * and tax multipliers rather than any country's, while `{country}` keeps
 * rendering the label stamped into `flags.countryLabel` when the life began.
 * Retiring an id is a one-way door for the saves that hold it.
 */
const countries: CountryDef[] = [
  {
    id: 'us',
    label: 'United States',
    flag: '🇺🇸',
    costMult: 1.0,
    taxMult: 1.0,
    visaDifficulty: 0.7,
  },
  {
    id: 'uk',
    label: 'United Kingdom',
    flag: '🇬🇧',
    costMult: 1.05,
    taxMult: 1.1,
    visaDifficulty: 0.6,
  },
  {
    id: 'ca',
    label: 'Canada',
    flag: '🇨🇦',
    costMult: 0.95,
    taxMult: 1.05,
    visaDifficulty: 0.5,
  },
  {
    id: 'au',
    label: 'Australia',
    flag: '🇦🇺',
    costMult: 1.0,
    taxMult: 1.0,
    visaDifficulty: 0.5,
  },
  {
    id: 'de',
    label: 'Germany',
    flag: '🇩🇪',
    costMult: 0.9,
    taxMult: 1.25,
    visaDifficulty: 0.55,
  },
  {
    id: 'fr',
    label: 'France',
    flag: '🇫🇷',
    costMult: 0.95,
    taxMult: 1.3,
    visaDifficulty: 0.55,
  },
  {
    id: 'jp',
    label: 'Japan',
    flag: '🇯🇵',
    costMult: 1.1,
    taxMult: 1.05,
    visaDifficulty: 0.75,
  },
  {
    id: 'br',
    label: 'Brazil',
    flag: '🇧🇷',
    costMult: 0.6,
    taxMult: 0.85,
    visaDifficulty: 0.35,
  },
  {
    id: 'ma',
    label: 'Morocco',
    flag: '🇲🇦',
    costMult: 0.5,
    taxMult: 0.8,
    visaDifficulty: 0.3,
  },
  {
    id: 'in',
    label: 'India',
    flag: '🇮🇳',
    costMult: 0.45,
    taxMult: 0.75,
    visaDifficulty: 0.3,
  },
];

/** Playable countries with their cost, tax and visa-difficulty multipliers. */
export const countriesPack: ContentPack = {
  id: 'countries',
  countries,
};
