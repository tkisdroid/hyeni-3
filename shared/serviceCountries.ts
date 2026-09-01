// ISO 3166-1 alpha-2 중 사용자 서비스 국가로 저장 가능한 값의 단일 정본이다.
// access-region의 ZZ fallback과 Google의 비ISO CLDR region code는 포함하지 않는다.
const SERVICE_COUNTRY_CODE_LIST = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU
MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA
SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM
US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
`.trim().split(/\s+/);

const ISO_3166_1_ALPHA_2_CODE_COUNT = 249;

if (
  SERVICE_COUNTRY_CODE_LIST.length !== ISO_3166_1_ALPHA_2_CODE_COUNT
  || new Set(SERVICE_COUNTRY_CODE_LIST).size !== ISO_3166_1_ALPHA_2_CODE_COUNT
) {
  throw new Error("service_country_iso_3166_1_alpha_2_list_invalid");
}

export const SERVICE_COUNTRY_CODES: readonly string[] = Object.freeze([
  ...SERVICE_COUNTRY_CODE_LIST,
]);

const SERVICE_COUNTRY_CODE_SET: ReadonlySet<string> = new Set(SERVICE_COUNTRY_CODES);

export function normalizeServiceCountry(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SERVICE_COUNTRY_CODE_SET.has(code) ? code : null;
}
