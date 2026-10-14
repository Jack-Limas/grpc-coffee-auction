import type { CoffeeProcess, Cupping, Lot, Origin } from "../domain/models";
import { newId } from "../infrastructure/ids";

/**
 * A rotating catalog of (fictional) Colombian specialty micro-lots.
 * Farms and producers are invented; regions, varieties and processes are real.
 */
export interface LotTemplate {
  readonly name: string;
  readonly variety: string;
  readonly process: CoffeeProcess;
  readonly origin: Origin;
  readonly cupping: Cupping;
  readonly weightLb: number;
  readonly startingPriceCents: number;
  /** reserve = starting * reserveFactor */
  readonly reserveFactor: number;
}

export const DEMO_CATALOG: readonly LotTemplate[] = [
  {
    name: "Cloud Forest Geisha",
    variety: "Geisha",
    process: "WASHED",
    origin: { farm: "Finca La Neblina", producer: "Ana Lucía Ortega", region: "Huila", municipality: "Pitalito", altitudeMasl: 1_950 },
    cupping: { scaScore: 91.5, tastingNotes: ["jasmine", "bergamot", "white peach"], cuppedBy: "Q-Grader Panel A" },
    weightLb: 132,
    startingPriceCents: 2_400,
    reserveFactor: 1.6,
  },
  {
    name: "Pink Bourbon Sunrise",
    variety: "Pink Bourbon",
    process: "NATURAL",
    origin: { farm: "Finca El Mirador", producer: "Julián Cárdenas", region: "Huila", municipality: "Acevedo", altitudeMasl: 1_780 },
    cupping: { scaScore: 89.25, tastingNotes: ["strawberry", "hibiscus", "panela"], cuppedBy: "Q-Grader Panel B" },
    weightLb: 198,
    startingPriceCents: 1_450,
    reserveFactor: 1.5,
  },
  {
    name: "Volcanic Sidra",
    variety: "Sidra",
    process: "ANAEROBIC",
    origin: { farm: "Finca Los Arrayanes", producer: "María Fernanda Bastidas", region: "Nariño", municipality: "La Unión", altitudeMasl: 2_100 },
    cupping: { scaScore: 90.75, tastingNotes: ["passion fruit", "cacao nib", "lime zest"], cuppedBy: "Q-Grader Panel A" },
    weightLb: 132,
    startingPriceCents: 1_900,
    reserveFactor: 1.55,
  },
  {
    name: "Andean Java",
    variety: "Java",
    process: "HONEY",
    origin: { farm: "Finca Monteverde", producer: "Hernán Ospina", region: "Cauca", municipality: "Inzá", altitudeMasl: 1_850 },
    cupping: { scaScore: 88.5, tastingNotes: ["green apple", "honeycomb", "black tea"], cuppedBy: "Q-Grader Panel C" },
    weightLb: 264,
    startingPriceCents: 1_100,
    reserveFactor: 1.4,
  },
  {
    name: "Chiroso Heritage",
    variety: "Chiroso",
    process: "WASHED",
    origin: { farm: "Finca La Esperanza", producer: "Rosa Elena Úsuga", region: "Antioquia", municipality: "Urrao", altitudeMasl: 1_920 },
    cupping: { scaScore: 90.0, tastingNotes: ["lemongrass", "rose", "mandarin"], cuppedBy: "Q-Grader Panel B" },
    weightLb: 132,
    startingPriceCents: 1_750,
    reserveFactor: 1.5,
  },
  {
    name: "Thermal Shock Tabi",
    variety: "Tabi",
    process: "THERMAL_SHOCK",
    origin: { farm: "Finca Bellavista", producer: "Camilo Restrepo", region: "Quindío", municipality: "Filandia", altitudeMasl: 1_700 },
    cupping: { scaScore: 89.0, tastingNotes: ["red grape", "cinnamon", "dark chocolate"], cuppedBy: "Q-Grader Panel C" },
    weightLb: 198,
    startingPriceCents: 1_250,
    reserveFactor: 1.45,
  },
  {
    name: "Planadas Caturra",
    variety: "Caturra",
    process: "WASHED",
    origin: { farm: "Finca San Isidro", producer: "Asociación Nasa Wesx", region: "Tolima", municipality: "Planadas", altitudeMasl: 1_800 },
    cupping: { scaScore: 87.5, tastingNotes: ["caramel", "orange", "almond"], cuppedBy: "Q-Grader Panel A" },
    weightLb: 330,
    startingPriceCents: 850,
    reserveFactor: 1.35,
  },
  {
    name: "Sierra Nevada Typica",
    variety: "Typica",
    process: "NATURAL",
    origin: { farm: "Finca Kaku", producer: "Cooperativa Arhuaca", region: "Sierra Nevada", municipality: "Pueblo Bello", altitudeMasl: 1_650 },
    cupping: { scaScore: 88.0, tastingNotes: ["blackberry", "molasses", "clove"], cuppedBy: "Q-Grader Panel B" },
    weightLb: 264,
    startingPriceCents: 980,
    reserveFactor: 1.4,
  },
  {
    name: "Wush Wush Reserve",
    variety: "Wush Wush",
    process: "ANAEROBIC",
    origin: { farm: "Finca El Paraíso", producer: "Diego Bermúdez", region: "Cauca", municipality: "Piendamó", altitudeMasl: 1_930 },
    cupping: { scaScore: 91.0, tastingNotes: ["lychee", "rose water", "mango"], cuppedBy: "Q-Grader Panel A" },
    weightLb: 132,
    startingPriceCents: 2_100,
    reserveFactor: 1.6,
  },
  {
    name: "Santander Shade-Grown Bourbon",
    variety: "Bourbon",
    process: "HONEY",
    origin: { farm: "Finca Guaduales", producer: "Luz Marina Pinzón", region: "Santander", municipality: "Barichara", altitudeMasl: 1_600 },
    cupping: { scaScore: 87.75, tastingNotes: ["brown sugar", "plum", "hazelnut"], cuppedBy: "Q-Grader Panel C" },
    weightLb: 330,
    startingPriceCents: 900,
    reserveFactor: 1.35,
  },
  {
    name: "Laurina Low-Caf",
    variety: "Laurina",
    process: "WASHED",
    origin: { farm: "Finca Altamira", producer: "Esteban Quintero", region: "Risaralda", municipality: "Santuario", altitudeMasl: 1_880 },
    cupping: { scaScore: 88.75, tastingNotes: ["chamomile", "pear", "vanilla"], cuppedBy: "Q-Grader Panel B" },
    weightLb: 198,
    startingPriceCents: 1_300,
    reserveFactor: 1.45,
  },
  {
    name: "Buesaco Castillo Honey",
    variety: "Castillo",
    process: "HONEY",
    origin: { farm: "Finca Tres Cruces", producer: "Familia Erazo", region: "Nariño", municipality: "Buesaco", altitudeMasl: 1_990 },
    cupping: { scaScore: 86.75, tastingNotes: ["red apple", "panela", "milk chocolate"], cuppedBy: "Q-Grader Panel C" },
    weightLb: 396,
    startingPriceCents: 750,
    reserveFactor: 1.3,
  },
];

export function createLot(
  template: LotTemplate,
  lotNumber: number,
  startsAt: Date,
  durationMs: number,
  now: Date,
): Lot {
  return {
    id: newId(),
    code: `CS-${String(lotNumber).padStart(4, "0")}`,
    name: template.name,
    variety: template.variety,
    process: template.process,
    origin: template.origin,
    cupping: template.cupping,
    weightLb: template.weightLb,
    status: startsAt <= now ? "LIVE" : "SCHEDULED",
    startingPriceCents: template.startingPriceCents,
    reservePriceCents: Math.round((template.startingPriceCents * template.reserveFactor) / 5) * 5,
    currentPriceCents: template.startingPriceCents,
    bidCount: 0,
    leaderBidderId: null,
    leaderPaddle: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + durationMs),
    extensionCount: 0,
    createdAt: now,
  };
}
