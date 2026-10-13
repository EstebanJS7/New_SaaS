/**
 * FISC-015 WU-D — the protocol's own countries: `paisType`.
 *
 * The receptor's country is `cPaisRec` and `dDesPaisRe` (§21.6, §22.3), both
 * required in `gDatRec`. **Both are the protocol's list, not tenant data** —
 * the artifact below publishes each ISO 3166 code with its name
 * (`PRY` -> `"Paraguay"`), so the description is a table lookup and never a
 * caller's default; and the code is **alpha-3**, which is what `paisType`
 * enumerates and not what this repository stores elsewhere (see below).
 *
 * **Generated from the artifact's own bytes, never typed by hand.**
 *
 * ```text
 * artifact    Paises_v100.xsd                  53,266 bytes   md5 437301d0afdb7b93a9b382e6709b65c1
 * directory   https://ekuatia.set.gov.py/sifen/xsd/
 * retrieved   2026-10-04, HTTP 200   (SIFEN-BASELINE.md §22.1)
 * regenerated 2026-10-10, from the same bytes, with a parser over `paisType`
 *             — 250 enumerations, 250 parsed, 249 distinct codes
 * ```
 *
 * **Three facts about the artifact's own list, each pinned by the suite.**
 *
 * 1. **It publishes 250 entries and 249 distinct codes.** `MKD` appears twice —
 *    `"Macedonia del Norte"` first and `"ex República Yugoslava de Macedonia"` later — a historical name the artifact never
 *    removed. Two names for one code cannot both live in a map keyed by the
 *    code, and **the first is kept**, in the artifact's own order, because a
 *    country's identity in the DE is its CODE: the protocol states no rule for
 *    the label, `tDesPais` is free text of 4..50 characters, and every
 *    published name fits it. Refusing `MKD` would make a legitimate receptor
 *    impossible to invoice over a duplicate label.
 * 2. **It publishes one code that is not a country: `NN`, `"NO EXISTE"`.** `paisType`'s last
 *    enumeration is a sentinel — two characters, not ISO 3166's three — and it
 *    is kept like every other published value, because "the protocol's list is
 *    the source of record" and a value SIFEN accepts must not be refused by a
 *    table of our own. Nothing here treats `NN` as a country: the receptor
 *    read only ever answers the code a customer's row carries.
 * 3. **Every name fits `tDesPais`**, 4..50 characters, checked while generating.
 *
 * The lookup **refuses** an unknown code rather than answering undefined: a
 * country the protocol does not publish must never become a document SIFEN
 * rejects. Note that a code of the wrong shape lands here too, and that is the
 * point: this repository's `customer_address.country_code` is validated as ISO
 * 3166 **alpha-2** (`apps/api/src/customers/customer-address.zod.ts`), so a
 * stored `"PY"` is not a `paisType` code and the receptor read refuses it
 * rather than emitting a country SIFEN cannot place.
 */

import { DteCatalogueError, namedCodeFor, type DteNamedCode } from "./dte.catalogues.js";

/** One `paisType` code and the name the artifact gives it. */
export type DteCountry = DteNamedCode;

/** The artifact's 249 distinct `paisType` codes, keyed by the published code. */
export const DTE_COUNTRIES: ReadonlyMap<string, DteCountry> = new Map([
  ["MKD", { code: "MKD", description: "Macedonia del Norte" }],
  ["TWN", { code: "TWN", description: "Taiwán (Provincia de China)" }],
  ["DZA", { code: "DZA", description: "Argelia" }],
  ["EGY", { code: "EGY", description: "Egipto" }],
  ["LBY", { code: "LBY", description: "Libia" }],
  ["MAR", { code: "MAR", description: "Marruecos" }],
  ["SDN", { code: "SDN", description: "Sudán" }],
  ["TUN", { code: "TUN", description: "Túnez" }],
  ["ESH", { code: "ESH", description: "Sáhara Occidental" }],
  ["IOT", { code: "IOT", description: "Territorio Británico del Océano Índico" }],
  ["BDI", { code: "BDI", description: "Burundi" }],
  ["COM", { code: "COM", description: "Comoras" }],
  ["DJI", { code: "DJI", description: "Djibouti" }],
  ["ERI", { code: "ERI", description: "Eritrea" }],
  ["ETH", { code: "ETH", description: "Etiopía" }],
  ["ATF", { code: "ATF", description: "Territorio de las Tierras Australes Francesas" }],
  ["KEN", { code: "KEN", description: "Kenya" }],
  ["MDG", { code: "MDG", description: "Madagascar" }],
  ["MWI", { code: "MWI", description: "Malawi" }],
  ["MUS", { code: "MUS", description: "Mauricio" }],
  ["MYT", { code: "MYT", description: "Mayotte" }],
  ["MOZ", { code: "MOZ", description: "Mozambique" }],
  ["REU", { code: "REU", description: "Reunión" }],
  ["RWA", { code: "RWA", description: "Rwanda" }],
  ["SYC", { code: "SYC", description: "Seychelles" }],
  ["SOM", { code: "SOM", description: "Somalia" }],
  ["SSD", { code: "SSD", description: "Sudán del Sur" }],
  ["UGA", { code: "UGA", description: "Uganda" }],
  ["TZA", { code: "TZA", description: "República Unida de Tanzanía" }],
  ["ZMB", { code: "ZMB", description: "Zambia" }],
  ["ZWE", { code: "ZWE", description: "Zimbabwe" }],
  ["AGO", { code: "AGO", description: "Angola" }],
  ["CMR", { code: "CMR", description: "Camerún" }],
  ["CAF", { code: "CAF", description: "República Centroafricana" }],
  ["TCD", { code: "TCD", description: "Chad" }],
  ["COG", { code: "COG", description: "Congo" }],
  ["COD", { code: "COD", description: "República Democrática del Congo" }],
  ["GNQ", { code: "GNQ", description: "Guinea Ecuatorial" }],
  ["GAB", { code: "GAB", description: "Gabón" }],
  ["STP", { code: "STP", description: "Santo Tomé y Príncipe" }],
  ["BWA", { code: "BWA", description: "Botswana" }],
  ["LSO", { code: "LSO", description: "Lesotho" }],
  ["NAM", { code: "NAM", description: "Namibia" }],
  ["ZAF", { code: "ZAF", description: "Sudáfrica" }],
  ["SWZ", { code: "SWZ", description: "Swazilandia" }],
  ["BEN", { code: "BEN", description: "Benin" }],
  ["BFA", { code: "BFA", description: "Burkina Faso" }],
  ["CPV", { code: "CPV", description: "Cabo Verde" }],
  ["CIV", { code: "CIV", description: "Côte d'Ivoire" }],
  ["GMB", { code: "GMB", description: "Gambia" }],
  ["GHA", { code: "GHA", description: "Ghana" }],
  ["GIN", { code: "GIN", description: "Guinea" }],
  ["GNB", { code: "GNB", description: "Guinea-Bissau" }],
  ["LBR", { code: "LBR", description: "Liberia" }],
  ["MLI", { code: "MLI", description: "Malí" }],
  ["MRT", { code: "MRT", description: "Mauritania" }],
  ["NER", { code: "NER", description: "Níger" }],
  ["NGA", { code: "NGA", description: "Nigeria" }],
  ["SHN", { code: "SHN", description: "Santa Elena" }],
  ["SEN", { code: "SEN", description: "Senegal" }],
  ["SLE", { code: "SLE", description: "Sierra Leona" }],
  ["TGO", { code: "TGO", description: "Togo" }],
  ["AIA", { code: "AIA", description: "Anguila" }],
  ["ATG", { code: "ATG", description: "Antigua y Barbuda" }],
  ["ABW", { code: "ABW", description: "Aruba" }],
  ["BHS", { code: "BHS", description: "Bahamas" }],
  ["BRB", { code: "BRB", description: "Barbados" }],
  ["BES", { code: "BES", description: "Bonaire, San Eustaquio y Saba" }],
  ["VGB", { code: "VGB", description: "Islas Vírgenes Británicas" }],
  ["CYM", { code: "CYM", description: "Islas Caimán" }],
  ["CUB", { code: "CUB", description: "CUBA" }],
  ["CUW", { code: "CUW", description: "Curaçao" }],
  ["DMA", { code: "DMA", description: "Dominica" }],
  ["DOM", { code: "DOM", description: "República Dominicana" }],
  ["GRD", { code: "GRD", description: "Granada" }],
  ["GLP", { code: "GLP", description: "Guadalupe" }],
  ["HTI", { code: "HTI", description: "Haití" }],
  ["JAM", { code: "JAM", description: "Jamaica" }],
  ["MTQ", { code: "MTQ", description: "Martinica" }],
  ["MSR", { code: "MSR", description: "Montserrat" }],
  ["PRI", { code: "PRI", description: "Puerto Rico" }],
  ["BLM", { code: "BLM", description: "San Bartolomé" }],
  ["KNA", { code: "KNA", description: "Saint Kitts y Nevis" }],
  ["LCA", { code: "LCA", description: "Santa Lucía" }],
  ["MAF", { code: "MAF", description: "San Martín (parte francesa)" }],
  ["VCT", { code: "VCT", description: "San Vicente y las Granadinas" }],
  ["SXM", { code: "SXM", description: "San Martín (parte holandés)" }],
  ["TTO", { code: "TTO", description: "Trinidad y Tabago" }],
  ["TCA", { code: "TCA", description: "Islas Turcas y Caicos" }],
  ["VIR", { code: "VIR", description: "Islas Vírgenes de los Estados Unidos" }],
  ["BLZ", { code: "BLZ", description: "Belice" }],
  ["CRI", { code: "CRI", description: "Costa Rica" }],
  ["SLV", { code: "SLV", description: "El Salvador" }],
  ["GTM", { code: "GTM", description: "Guatemala" }],
  ["HND", { code: "HND", description: "Honduras" }],
  ["MEX", { code: "MEX", description: "México" }],
  ["NIC", { code: "NIC", description: "Nicaragua" }],
  ["PAN", { code: "PAN", description: "Panamá" }],
  ["ARG", { code: "ARG", description: "Argentina" }],
  ["BOL", { code: "BOL", description: "Bolivia (Estado Plurinacional de)" }],
  ["BRA", { code: "BRA", description: "Brasil" }],
  ["CHL", { code: "CHL", description: "Chile" }],
  ["COL", { code: "COL", description: "Colombia" }],
  ["ECU", { code: "ECU", description: "Ecuador" }],
  ["FLK", { code: "FLK", description: "Islas Malvinas (Falkland)" }],
  ["GUF", { code: "GUF", description: "Guayana Francesa" }],
  ["GUY", { code: "GUY", description: "Guyana" }],
  ["PRY", { code: "PRY", description: "Paraguay" }],
  ["PER", { code: "PER", description: "Perú" }],
  ["SGS", { code: "SGS", description: "Georgia del Sur y las Islas Sandwich del Sur" }],
  ["SUR", { code: "SUR", description: "Suriname" }],
  ["URY", { code: "URY", description: "Uruguay" }],
  ["VEN", { code: "VEN", description: "Venezuela (República Bolivariana de)" }],
  ["BMU", { code: "BMU", description: "Bermuda" }],
  ["CAN", { code: "CAN", description: "Canadá" }],
  ["GRL", { code: "GRL", description: "Groenlandia" }],
  ["SPM", { code: "SPM", description: "Saint Pierre y Miquelon" }],
  ["USA", { code: "USA", description: "Estados Unidos de América" }],
  ["ATA", { code: "ATA", description: "Antártida" }],
  ["KAZ", { code: "KAZ", description: "Kazajstán" }],
  ["KGZ", { code: "KGZ", description: "Kirguistán" }],
  ["TJK", { code: "TJK", description: "Tayikistán" }],
  ["TKM", { code: "TKM", description: "Turkmenistán" }],
  ["UZB", { code: "UZB", description: "Uzbekistán" }],
  ["CHN", { code: "CHN", description: "China" }],
  ["HKG", { code: "HKG", description: "Hong Kong" }],
  ["MAC", { code: "MAC", description: "Macao" }],
  ["PRK", { code: "PRK", description: "República Popular Democrática de Corea" }],
  ["JPN", { code: "JPN", description: "Japón" }],
  ["MNG", { code: "MNG", description: "Mongolia" }],
  ["KOR", { code: "KOR", description: "República de Corea" }],
  ["BRN", { code: "BRN", description: "Brunei Darussalam" }],
  ["KHM", { code: "KHM", description: "Camboya" }],
  ["IDN", { code: "IDN", description: "Indonesia" }],
  ["LAO", { code: "LAO", description: "República Democrática Popular Lao" }],
  ["MYS", { code: "MYS", description: "Malasia" }],
  ["MMR", { code: "MMR", description: "Myanmar" }],
  ["PHL", { code: "PHL", description: "Filipinas" }],
  ["SGP", { code: "SGP", description: "Singapur" }],
  ["THA", { code: "THA", description: "Tailandia" }],
  ["TLS", { code: "TLS", description: "Timor-Leste" }],
  ["VNM", { code: "VNM", description: "Viet Nam" }],
  ["AFG", { code: "AFG", description: "Afganistán" }],
  ["BGD", { code: "BGD", description: "Bangladesh" }],
  ["BTN", { code: "BTN", description: "Bhután" }],
  ["IND", { code: "IND", description: "India" }],
  ["IRN", { code: "IRN", description: "Irán (República Islámica del)" }],
  ["MDV", { code: "MDV", description: "Maldivas" }],
  ["NPL", { code: "NPL", description: "Nepal" }],
  ["PAK", { code: "PAK", description: "Pakistán" }],
  ["LKA", { code: "LKA", description: "Sri Lanka" }],
  ["ARM", { code: "ARM", description: "Armenia" }],
  ["AZE", { code: "AZE", description: "Azerbaiyán" }],
  ["BHR", { code: "BHR", description: "Bahrein" }],
  ["CYP", { code: "CYP", description: "Chipre" }],
  ["GEO", { code: "GEO", description: "Georgia" }],
  ["IRQ", { code: "IRQ", description: "Iraq" }],
  ["ISR", { code: "ISR", description: "Israel" }],
  ["JOR", { code: "JOR", description: "Jordania" }],
  ["KWT", { code: "KWT", description: "Kuwait" }],
  ["LBN", { code: "LBN", description: "Líbano" }],
  ["OMN", { code: "OMN", description: "Omán" }],
  ["QAT", { code: "QAT", description: "Qatar" }],
  ["SAU", { code: "SAU", description: "Arabia Saudita" }],
  ["PSE", { code: "PSE", description: "Estado de Palestina" }],
  ["SYR", { code: "SYR", description: "República Árabe Siria" }],
  ["TUR", { code: "TUR", description: "Turquía" }],
  ["ARE", { code: "ARE", description: "Emiratos Árabes Unidos" }],
  ["YEM", { code: "YEM", description: "Yemen" }],
  ["BLR", { code: "BLR", description: "Belarús" }],
  ["BGR", { code: "BGR", description: "Bulgaria" }],
  ["CZE", { code: "CZE", description: "Chequia" }],
  ["HUN", { code: "HUN", description: "Hungría" }],
  ["POL", { code: "POL", description: "Polonia" }],
  ["MDA", { code: "MDA", description: "República de Moldova" }],
  ["ROU", { code: "ROU", description: "Rumania" }],
  ["RUS", { code: "RUS", description: "Federación de Rusia" }],
  ["SVK", { code: "SVK", description: "Eslovaquia" }],
  ["UKR", { code: "UKR", description: "Ucrania" }],
  ["ALA", { code: "ALA", description: "Islas Åland" }],
  ["GGY", { code: "GGY", description: "Guernsey" }],
  ["JEY", { code: "JEY", description: "Jersey" }],
  ["DNK", { code: "DNK", description: "Dinamarca" }],
  ["EST", { code: "EST", description: "Estonia" }],
  ["FRO", { code: "FRO", description: "Islas Feroe" }],
  ["FIN", { code: "FIN", description: "Finlandia" }],
  ["ISL", { code: "ISL", description: "Islandia" }],
  ["IRL", { code: "IRL", description: "Irlanda" }],
  ["IMN", { code: "IMN", description: "Isla de Man" }],
  ["LVA", { code: "LVA", description: "Letonia" }],
  ["LTU", { code: "LTU", description: "Lituania" }],
  ["NOR", { code: "NOR", description: "Noruega" }],
  ["SJM", { code: "SJM", description: "Islas Svalbard y Jan Mayen" }],
  ["SWE", { code: "SWE", description: "Suecia" }],
  ["GBR", { code: "GBR", description: "Reino Unido de Gran Bretaña e Irlanda del Norte" }],
  ["ALB", { code: "ALB", description: "Albania" }],
  ["AND", { code: "AND", description: "Andorra" }],
  ["BIH", { code: "BIH", description: "Bosnia y Herzegovina" }],
  ["HRV", { code: "HRV", description: "Croacia" }],
  ["GIB", { code: "GIB", description: "Gibraltar" }],
  ["GRC", { code: "GRC", description: "Grecia" }],
  ["VAT", { code: "VAT", description: "Santa Sede" }],
  ["ITA", { code: "ITA", description: "Italia" }],
  ["MLT", { code: "MLT", description: "Malta" }],
  ["MNE", { code: "MNE", description: "Montenegro" }],
  ["PRT", { code: "PRT", description: "Portugal" }],
  ["SMR", { code: "SMR", description: "San Marino" }],
  ["SRB", { code: "SRB", description: "Serbia" }],
  ["SVN", { code: "SVN", description: "Eslovenia" }],
  ["ESP", { code: "ESP", description: "España" }],
  ["AUT", { code: "AUT", description: "Austria" }],
  ["BEL", { code: "BEL", description: "Bélgica" }],
  ["FRA", { code: "FRA", description: "Francia" }],
  ["DEU", { code: "DEU", description: "Alemania" }],
  ["LIE", { code: "LIE", description: "Liechtenstein" }],
  ["LUX", { code: "LUX", description: "Luxemburgo" }],
  ["MCO", { code: "MCO", description: "Mónaco" }],
  ["NLD", { code: "NLD", description: "Países Bajos" }],
  ["CHE", { code: "CHE", description: "Suiza" }],
  ["AUS", { code: "AUS", description: "Australia" }],
  ["CXR", { code: "CXR", description: "Isla de Navidad" }],
  ["CCK", { code: "CCK", description: "Islas Cocos (Keeling)" }],
  ["HMD", { code: "HMD", description: "Islas Heard y McDonald" }],
  ["NZL", { code: "NZL", description: "Nueva Zelandia" }],
  ["NFK", { code: "NFK", description: "Islas Norfolk" }],
  ["FJI", { code: "FJI", description: "Fiji" }],
  ["NCL", { code: "NCL", description: "Nueva Caledonia" }],
  ["PNG", { code: "PNG", description: "Papua Nueva Guinea" }],
  ["SLB", { code: "SLB", description: "Islas Salomón" }],
  ["VUT", { code: "VUT", description: "Vanuatu" }],
  ["GUM", { code: "GUM", description: "Guam" }],
  ["KIR", { code: "KIR", description: "Kiribati" }],
  ["MHL", { code: "MHL", description: "Islas Marshall" }],
  ["FSM", { code: "FSM", description: "Micronesia (Estados Federados de)" }],
  ["NRU", { code: "NRU", description: "Nauru" }],
  ["MNP", { code: "MNP", description: "Islas Marianas Septentrionales" }],
  ["PLW", { code: "PLW", description: "Palau" }],
  ["UMI", { code: "UMI", description: "Islas menores alejadas de Estados Unidos" }],
  ["ASM", { code: "ASM", description: "Samoa Americana" }],
  ["COK", { code: "COK", description: "Islas Cook" }],
  ["PYF", { code: "PYF", description: "Polinesia Francesa" }],
  ["NIU", { code: "NIU", description: "Niue" }],
  ["PCN", { code: "PCN", description: "Pitcairn" }],
  ["WSM", { code: "WSM", description: "Samoa" }],
  ["TKL", { code: "TKL", description: "Tokelau" }],
  ["TON", { code: "TON", description: "Tonga" }],
  ["TUV", { code: "TUV", description: "Tuvalu" }],
  ["WLF", { code: "WLF", description: "Islas Wallis y Futuna" }],
  ["NN", { code: "NN", description: "NO EXISTE" }],
]);

/** The entry for a code, or a failure naming the code and this table. */
export function countryFor(code: string): DteCountry {
  return namedCodeFor(DTE_COUNTRIES, code, "country published by Paises_v100.xsd");
}

/** The `dDesPaisRe` name for a code, e.g. `"Paraguay"` for `PRY`. */
export function describeCountry(code: string): string {
  return countryFor(code).description;
}

// Re-exported so a caller that catches this module's refusals needs one import.
export { DteCatalogueError };
