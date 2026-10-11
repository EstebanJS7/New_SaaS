/**
 * FISC-015 WU-D — the protocol's own currencies: `cMondT`.
 *
 * The DE carries `D015 cMoneOpe` and `D016 dDesMoneOpe` (§21.6, §22.4): the
 * invoice's currency and the currency's own name. **Both are the protocol's
 * list, not tenant data** — the artifact below publishes each ISO 4217 code
 * with its name (`PYG` -> `"Guarani"`), so `dDesMoneOpe` is a table lookup
 * and never a caller's default. The mapper takes `currencyDescription` as an
 * input ([[FISC-015]]'s "Known limitations this unit created"), and this table
 * is what fills it.
 *
 * **Generated from the artifact's own bytes, never typed by hand.**
 *
 * ```text
 * artifact    Monedas_v150.xsd                57,236 bytes   md5 b7ce517aa17450ceaa4a8f9d8dd02a16
 * directory   https://ekuatia.set.gov.py/sifen/xsd/
 * retrieved   2026-10-04, HTTP 200   (SIFEN-BASELINE.md §22.1)
 * regenerated 2026-10-10, from the same bytes, with a parser over `cMondT`'s
 *             own `CodeName` elements — 200 enumerations, 200 parsed
 * ```
 *
 * **Every code the artifact publishes is here** — 200 of them, in the
 * artifact's own order. A partial table would refuse a legitimate value, and a
 * refused legitimate value is an invoice that cannot be issued.
 *
 * **One bound the artifact's own DE type imposes.** `dDesMoneOpe`'s type is
 * `tdDMoneTiPag`, 3..20 characters, and **15 of the 200 names are longer
 * than 20** — the longest is `XXX` -> `"The codes assigned for transactions where no currency is involved"`, 65
 * characters. The name is still the protocol's own, so this table publishes it
 * as the artifact spells it; `DTE_CURRENCY_DESCRIPTION_MAX_LENGTH` is exported
 * so the caller that would emit it refuses instead of writing a value the
 * schema cannot carry.
 *
 * The lookup **refuses** an unknown code rather than answering undefined: a
 * currency the protocol does not publish must never become a document SIFEN
 * rejects.
 */

import { DteCatalogueError, namedCodeFor, type DteNamedCode } from "./dte.catalogues.js";

/** One `cMondT` code and the name the artifact gives it. */
export type DteCurrency = DteNamedCode;

/**
 * `tdDMoneTiPag`'s `maxLength` (`DE_Types_v150.xsd`), the bound
 * `dDesMoneOpe` is emitted under. Exported because the caller that builds the
 * DE is the one that must refuse: this table's job is to be faithful to the
 * artifact, and the artifact's list is what it is.
 */
export const DTE_CURRENCY_DESCRIPTION_MAX_LENGTH = 20;

/** The artifact's 200 `cMondT` codes, keyed by the ISO 4217 code. */
export const DTE_CURRENCIES: ReadonlyMap<string, DteCurrency> = new Map([
  ["AED", { code: "AED", description: "Dirham" }],
  ["AFN", { code: "AFN", description: "Afghani" }],
  ["ALL", { code: "ALL", description: "Lek" }],
  ["AMD", { code: "AMD", description: "Dram" }],
  ["ANG", { code: "ANG", description: "Netherlands Antillian Guilder" }],
  ["AOA", { code: "AOA", description: "Kwanza" }],
  ["ARS", { code: "ARS", description: "Argentine Peso" }],
  ["AUD", { code: "AUD", description: "Australian Dollar" }],
  ["AWG", { code: "AWG", description: "Aruban Guilder" }],
  ["AZM", { code: "AZM", description: "Azerbaijanian Manat" }],
  ["BAM", { code: "BAM", description: "Convertible Mark" }],
  ["BBD", { code: "BBD", description: "Barbados Dollar" }],
  ["BYN", { code: "BYN", description: "Belarusian Ruble" }],
  ["BDT", { code: "BDT", description: "Taka" }],
  ["BGN", { code: "BGN", description: "Bulgarian Lev" }],
  ["BHD", { code: "BHD", description: "Bahraini Dinar" }],
  ["BIF", { code: "BIF", description: "Burundi Franc" }],
  ["BMD", { code: "BMD", description: "Bermudian Dollar (customarily: Bermuda Dollar)" }],
  ["BND", { code: "BND", description: "Brunei Dollar" }],
  ["BOB", { code: "BOB", description: "Boliviano" }],
  ["BOV", { code: "BOV", description: "Mvdol" }],
  ["BRL", { code: "BRL", description: "Brazilian Real" }],
  ["BSD", { code: "BSD", description: "Bahamian Dollar" }],
  ["BTN", { code: "BTN", description: "Ngultrum" }],
  ["BWP", { code: "BWP", description: "Pula" }],
  ["BYR", { code: "BYR", description: "Belarussian Ruble" }],
  ["BZD", { code: "BZD", description: "Belize Dollar" }],
  ["CAD", { code: "CAD", description: "Canadian Dollar" }],
  ["CDF", { code: "CDF", description: "Franc Congolais" }],
  ["CHF", { code: "CHF", description: "Swiss Franc" }],
  ["CHE", { code: "CHE", description: "WIR Euro" }],
  ["CHW", { code: "CHW", description: "WIR Franc" }],
  ["CLP", { code: "CLP", description: "Chilean Peso" }],
  ["CLF", { code: "CLF", description: "Unidad de Fomento" }],
  ["CNY", { code: "CNY", description: "Yuan Renminbi" }],
  ["COP", { code: "COP", description: "Colombian Peso" }],
  ["COU", { code: "COU", description: "Unidad de Valor Real" }],
  ["CRC", { code: "CRC", description: "Costa Rican Colon" }],
  ["CUP", { code: "CUP", description: "Cuban Peso" }],
  ["CUC", { code: "CUC", description: "Peso Convertible" }],
  ["CVE", { code: "CVE", description: "Cape Verde Escudo" }],
  ["CYP", { code: "CYP", description: "Cyprus Pound" }],
  ["CZK", { code: "CZK", description: "Czech Koruna" }],
  ["DJF", { code: "DJF", description: "Djibouti Franc" }],
  ["DKK", { code: "DKK", description: "Danish Krone" }],
  ["DOP", { code: "DOP", description: "Dominican Peso" }],
  ["DZD", { code: "DZD", description: "Algerian Dinar" }],
  ["EEK", { code: "EEK", description: "Kroon" }],
  ["EGP", { code: "EGP", description: "Egyptian Pound" }],
  ["ERN", { code: "ERN", description: "Nakfa" }],
  ["ETB", { code: "ETB", description: "Ethopian Birr" }],
  ["EUR", { code: "EUR", description: "Euro" }],
  ["FJD", { code: "FJD", description: "Fiji Dollar" }],
  ["FKP", { code: "FKP", description: "Falkland Islands Pound" }],
  ["GBP", { code: "GBP", description: "Pound Sterling" }],
  ["GEL", { code: "GEL", description: "Lari" }],
  ["GHS", { code: "GHS", description: "Ghana Cedi" }],
  ["GHC", { code: "GHC", description: "Cedi" }],
  ["GIP", { code: "GIP", description: "Gibraltar Pound" }],
  ["GMD", { code: "GMD", description: "Dalasi" }],
  ["GNF", { code: "GNF", description: "Guinea Franc" }],
  ["GTQ", { code: "GTQ", description: "Quetzal" }],
  ["GYD", { code: "GYD", description: "Guyana Dollar" }],
  ["HKD", { code: "HKD", description: "Honk Kong Dollar" }],
  ["HNL", { code: "HNL", description: "Lempira" }],
  ["HRK", { code: "HRK", description: "Kuna" }],
  ["HTG", { code: "HTG", description: "Gourde" }],
  ["HUF", { code: "HUF", description: "Forint" }],
  ["IDR", { code: "IDR", description: "Rupiah" }],
  ["ILS", { code: "ILS", description: "New Israeli Sheqel" }],
  ["INR", { code: "INR", description: "Indian Rupee" }],
  ["IQD", { code: "IQD", description: "Iraqi Dinar" }],
  ["IRR", { code: "IRR", description: "Iranian Rial" }],
  ["ISK", { code: "ISK", description: "Iceland Krona" }],
  ["JMD", { code: "JMD", description: "Jamaican Dollar" }],
  ["JOD", { code: "JOD", description: "Jordanian Dinar" }],
  ["JPY", { code: "JPY", description: "Yen" }],
  ["KES", { code: "KES", description: "Kenyan Shilling" }],
  ["KGS", { code: "KGS", description: "Som" }],
  ["KHR", { code: "KHR", description: "Riel" }],
  ["KMF", { code: "KMF", description: "Comoro Franc" }],
  ["KPW", { code: "KPW", description: "North Korean Won" }],
  ["KRW", { code: "KRW", description: "Won" }],
  ["KWD", { code: "KWD", description: "Kuwaiti Dinar" }],
  ["KYD", { code: "KYD", description: "Cayman Islands Dollar" }],
  ["KZT", { code: "KZT", description: "Tenge" }],
  ["LAK", { code: "LAK", description: "Kip" }],
  ["LBP", { code: "LBP", description: "Lebanese Pound" }],
  ["LKR", { code: "LKR", description: "Sri Lanka Rupee" }],
  ["LRD", { code: "LRD", description: "Liberian Dollar" }],
  ["LSL", { code: "LSL", description: "Loti" }],
  ["LTL", { code: "LTL", description: "Lithuanian Litas" }],
  ["LVL", { code: "LVL", description: "Latvian Lats" }],
  ["LYD", { code: "LYD", description: "Libyan Dinar" }],
  ["MAD", { code: "MAD", description: "Morrocan Dirham" }],
  ["MZN", { code: "MZN", description: "Mozambique Metical" }],
  ["MDL", { code: "MDL", description: "Moldovan Leu" }],
  ["MGF", { code: "MGF", description: "Malagasy Franc" }],
  ["MKD", { code: "MKD", description: "Denar" }],
  ["MGA", { code: "MGA", description: "Malagasy Ariary" }],
  ["MMK", { code: "MMK", description: "Kyat" }],
  ["MNT", { code: "MNT", description: "Tugrik" }],
  ["MOP", { code: "MOP", description: "Pataca" }],
  ["MRO", { code: "MRO", description: "Ouguiya" }],
  ["MTL", { code: "MTL", description: "Maltese Lira" }],
  ["MUR", { code: "MUR", description: "Mauritius Rupee" }],
  ["XUA", { code: "XUA", description: "ADB Unit of Account" }],
  ["MVR", { code: "MVR", description: "Rufiyaa" }],
  ["MRU", { code: "MRU", description: "Ouguiya" }],
  ["MWK", { code: "MWK", description: "Kwacha" }],
  ["MXN", { code: "MXN", description: "Mexican Peso" }],
  ["MXV", { code: "MXV", description: "Mexican Unidad de Inversion" }],
  ["MYR", { code: "MYR", description: "Malaysian Ringgit" }],
  ["MZM", { code: "MZM", description: "Metical" }],
  ["NAD", { code: "NAD", description: "Namibia Dollar" }],
  ["NGN", { code: "NGN", description: "Naira" }],
  ["NIO", { code: "NIO", description: "Cordoba Oro" }],
  ["NOK", { code: "NOK", description: "Norwegian Krone" }],
  ["NPR", { code: "NPR", description: "Nepalese Rupee" }],
  ["NZD", { code: "NZD", description: "New Zealand Dollar" }],
  ["OMR", { code: "OMR", description: "Rial Omani" }],
  ["PAB", { code: "PAB", description: "Balboa" }],
  ["PEN", { code: "PEN", description: "Nuevo Sol" }],
  ["PGK", { code: "PGK", description: "Kina" }],
  ["PHP", { code: "PHP", description: "Philippine Peso" }],
  ["PKR", { code: "PKR", description: "Pakistan Rupee" }],
  ["PLN", { code: "PLN", description: "Zloty" }],
  ["PYG", { code: "PYG", description: "Guarani" }],
  ["QAR", { code: "QAR", description: "Qatari Rial" }],
  ["RON", { code: "RON", description: "Romanian Leu" }],
  ["ROL", { code: "ROL", description: "Leu" }],
  ["RUB", { code: "RUB", description: "Russian Ruble" }],
  ["RWF", { code: "RWF", description: "Rwanda Franc" }],
  ["SAR", { code: "SAR", description: "Saudi Riyal" }],
  ["RSD", { code: "RSD", description: "Serbian Dinar" }],
  ["SBD", { code: "SBD", description: "Solomon Islands Dollar" }],
  ["SCR", { code: "SCR", description: "Seychelles Rupee" }],
  ["SDD", { code: "SDD", description: "Sudanese Dinar" }],
  ["SDG", { code: "SDG", description: "Sudanese Pound" }],
  ["SRD", { code: "SRD", description: "Surinam Dollar" }],
  ["SEK", { code: "SEK", description: "Swedish Krona" }],
  ["SGD", { code: "SGD", description: "Singapore Dollar" }],
  ["SHP", { code: "SHP", description: "St. Helena Pound" }],
  ["SIT", { code: "SIT", description: "Tolar" }],
  ["SKK", { code: "SKK", description: "Slovak Koruna" }],
  ["SLL", { code: "SLL", description: "Leone" }],
  ["SOS", { code: "SOS", description: "Somali Shilling" }],
  ["SRG", { code: "SRG", description: "Suriname Guilder" }],
  ["SSP", { code: "SSP", description: "South Sudanese Pound" }],
  ["STD", { code: "STD", description: "Dobra" }],
  ["SVC", { code: "SVC", description: "El Salvador Colon" }],
  ["SYP", { code: "SYP", description: "Syrian Pound" }],
  ["SZL", { code: "SZL", description: "Lilangeni" }],
  ["THB", { code: "THB", description: "Baht" }],
  ["TJS", { code: "TJS", description: "Somoni" }],
  ["TMM", { code: "TMM", description: "Manat" }],
  ["TND", { code: "TND", description: "Tunisian Dinar" }],
  ["TRY", { code: "TRY", description: "Turkish Lira" }],
  ["TMT", { code: "TMT", description: "Turkmenistan New Manat" }],
  ["TOP", { code: "TOP", description: "Pa&apos;anga" }],
  ["TRL", { code: "TRL", description: "Turkish Lira" }],
  ["TTD", { code: "TTD", description: "Trinidad and Tobago Dollar" }],
  ["TWD", { code: "TWD", description: "New Taiwan Dollar" }],
  ["TZS", { code: "TZS", description: "Tanzanian Shilling" }],
  ["UAH", { code: "UAH", description: "Hryvnia" }],
  ["UGX", { code: "UGX", description: "Uganda Shilling" }],
  ["USD", { code: "USD", description: "US Dollar" }],
  ["USN", { code: "USN", description: "US Dollar(Next day)" }],
  ["UYU", { code: "UYU", description: "Peso Uruguayo" }],
  ["UYI", { code: "UYI", description: "Uruguay Peso en Unidades Indexadas(UI)" }],
  ["UYW", { code: "UYW", description: "Unidad Previsional" }],
  ["UZS", { code: "UZS", description: "Uzbekistan Sum" }],
  ["VEB", { code: "VEB", description: "Bolivar" }],
  ["VND", { code: "VND", description: "Dong" }],
  ["VUV", { code: "VUV", description: "Vatu" }],
  ["VES", { code: "VES", description: "Bolivar Soberano" }],
  ["WST", { code: "WST", description: "Tala" }],
  ["STN", { code: "STN", description: "Dobra" }],
  ["XAF", { code: "XAF", description: "CFA Franc" }],
  ["XAG", { code: "XAG", description: "Silver" }],
  ["XAU", { code: "XAU", description: "Gold" }],
  ["XCD", { code: "XCD", description: "East Carribean Dollar" }],
  ["XDR", { code: "XDR", description: "SDR" }],
  ["XOF", { code: "XOF", description: "CFA Franc" }],
  ["XPD", { code: "XPD", description: "Palladium" }],
  ["XPF", { code: "XPF", description: "CFP Franc" }],
  ["XPT", { code: "XPT", description: "Platinum" }],
  ["XSU", { code: "XSU", description: "Sucre" }],
  ["XBA", { code: "XBA", description: "Bond Markets Unit European Composite Unit(EURCO)" }],
  ["XBB", { code: "XBB", description: "Bond Markets Unit European Monetary Unit(E.M.U.-6)" }],
  [
    "XBC",
    { code: "XBC", description: "Bond Markets Unit European Unit of Account 17 (E.U.A.-17)" },
  ],
  ["XTS", { code: "XTS", description: "Codes specifically reserved for testing purposes" }],
  [
    "XXX",
    {
      code: "XXX",
      description: "The codes assigned for transactions where no currency is involved",
    },
  ],
  ["YER", { code: "YER", description: "Yemeni Rial" }],
  ["YUM", { code: "YUM", description: "New Dinar" }],
  ["ZMW", { code: "ZMW", description: "Zambian Kwacha" }],
  ["ZWL", { code: "ZWL", description: "Zimbabwe Dollar" }],
  ["ZAR", { code: "ZAR", description: "Rand" }],
  ["ZMK", { code: "ZMK", description: "Kwacha" }],
  ["ZWD", { code: "ZWD", description: "Zimbabwe Dollar" }],
]);

/** The entry for a code, or a failure naming the code and this table. */
export function currencyFor(code: string): DteCurrency {
  return namedCodeFor(DTE_CURRENCIES, code, "currency published by Monedas_v150.xsd");
}

/** The `dDesMoneOpe` name for a code, e.g. `"Guarani"` for `PYG`. */
export function describeCurrency(code: string): string {
  return currencyFor(code).description;
}

// Re-exported so a caller that catches this module's refusals needs one import.
export { DteCatalogueError };
