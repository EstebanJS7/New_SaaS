/**
 * FISC-008 WU-A — the pure DE XML builder.
 *
 * `buildDteXml` is a total function from a validated request to an XML string:
 * no ambient clock, no randomness, no I/O, no tenant context. Element order is
 * the schema's (`rDE` with four children, `DE` with eleven), so a DE whose
 * children are reordered is invalid rather than merely unconventional
 * (`docs/06-fiscal/SIFEN-BASELINE.md` §4, §21.1, §21.2).
 *
 * The `<Signature>` element is emitted as the schema's placeholder; producing
 * its content is [[FISC-009]]'s. `gCamFuFD` sits outside the signed `DE` by the
 * same sections.
 */

import { assertValidDteRequest } from "./dte.rules.js";
import {
  DTE_NAMESPACE,
  DTE_XML_VERSION,
  XMLDSIG_NAMESPACE,
  type DteCamposFueraFirma,
  type DteEmisor,
  type DteOperacionComercial,
  type DteReceptor,
  type DteRequest,
  type DteXmlElement,
} from "./dte.types.js";

export function buildDteXml(request: DteRequest): string {
  assertValidDteRequest(request);

  const lines = [
    `<rDE xmlns="${DTE_NAMESPACE}">`,
    `  <dVerFor>${DTE_XML_VERSION}</dVerFor>`,
    `  <DE Id="${escapeXmlAttribute(request.cdc)}">`,
    `    <dDVId>${escapeXmlText(request.dDVId)}</dDVId>`,
    `    <dFecFirma>${escapeXmlText(request.dFecFirma)}</dFecFirma>`,
    `    <dSisFact>1</dSisFact>`,
    ...renderOperationEmission(request, 4),
    ...renderTimbrado(request, 4),
    ...renderGeneralOperation(request, 4),
    ...renderGroup("gDtipDE", request.gDtipDE ?? [], 4),
    ...renderOptionalGroup("gTotSub", request.gTotSub, 4),
    ...renderOptionalGroup("gCamGen", request.gCamGen, 4),
    ...(request.gCamDEAsoc ?? []).flatMap((associated) => renderGroup("gCamDEAsoc", associated, 4)),
    `  </DE>`,
    `  <Signature xmlns="${XMLDSIG_NAMESPACE}"/>`,
    ...renderCamposFueraFirma(request.gCamFuFD, 2),
    `</rDE>`,
  ];

  return `${lines.join("\n")}\n`;
}

/** `gOpeDE` / `tgCOpeDE`: §4 pins exactly these five members. */
function renderOperationEmission(request: DteRequest, indent: number): string[] {
  const operation = request.gOpeDE;
  return renderGroup(
    "gOpeDE",
    [
      { name: "iTipEmi", value: String(operation.iTipEmi), enumType: "tiTipEmi" },
      { name: "dDesTipEmi", value: operation.dDesTipEmi },
      { name: "dCodSeg", value: operation.dCodSeg },
      optionalElement("dInfoEmi", operation.dInfoEmi),
      optionalElement("dInfoFisc", operation.dInfoFisc),
    ],
    indent
  );
}

/** `gTimb` / `tgDTim`. */
function renderTimbrado(request: DteRequest, indent: number): string[] {
  const timbrado = request.gTimb;
  return renderGroup(
    "gTimb",
    [
      { name: "iTiDE", value: String(timbrado.iTiDE), enumType: "tiTiDE" },
      { name: "dDesTiDE", value: timbrado.dDesTiDE },
      { name: "dNumTim", value: timbrado.dNumTim },
      { name: "dEst", value: timbrado.dEst },
      { name: "dPunExp", value: timbrado.dPunExp },
      { name: "dNumDoc", value: timbrado.dNumDoc },
      optionalElement("dSerieNum", timbrado.dSerieNum),
      { name: "dFeIniT", value: timbrado.dFeIniT, dateNotBefore20180501: true },
    ],
    indent
  );
}

/** `gDatGralOpe` / `tgDaGOC`. */
function renderGeneralOperation(request: DteRequest, indent: number): string[] {
  const general = request.gDatGralOpe;
  return renderGroup(
    "gDatGralOpe",
    [
      { name: "dFeEmiDE", value: general.dFeEmiDE },
      general.gOpeCom === undefined ? undefined : renderOperacionComercial(general.gOpeCom),
      renderEmisor(general.gEmis),
      renderReceptor(general.gDatRec),
    ],
    indent
  );
}

/** `gOpeCom` / `tgOpeCom`. */
function renderOperacionComercial(commercial: DteOperacionComercial): DteXmlElement {
  return {
    name: "gOpeCom",
    children: compact([
      optionalElement("iTipTra", commercial.iTipTra?.toString()),
      optionalElement("dDesTipTra", commercial.dDesTipTra),
      { name: "iTImp", value: String(commercial.iTImp), enumType: "tiTImp" },
      { name: "dDesTImp", value: commercial.dDesTImp },
      { name: "cMoneOpe", value: commercial.cMoneOpe },
      { name: "dDesMoneOpe", value: commercial.dDesMoneOpe },
      optionalElement("dCondTiCam", commercial.dCondTiCam?.toString()),
      commercial.dTiCam === undefined
        ? undefined
        : { name: "dTiCam", value: commercial.dTiCam, decimalType: "tTipoCambioBase" },
      optionalElement("iCondAnt", commercial.iCondAnt?.toString()),
      optionalElement("dDesCondAnt", commercial.dDesCondAnt),
      ...(commercial.gOblAfe ?? []).map((obligation): DteXmlElement => ({
        name: "gOblAfe",
        children: [
          { name: "cOblAfe", value: obligation.cOblAfe },
          { name: "dDesOblAfe", value: obligation.dDesOblAfe },
        ],
      })),
    ]),
  };
}

/** `gEmis` / `tgEmis`. */
function renderEmisor(emitter: DteEmisor): DteXmlElement {
  return {
    name: "gEmis",
    children: compact([
      { name: "dRucEm", value: emitter.dRucEm },
      { name: "dDVEmi", value: emitter.dDVEmi },
      { name: "iTipCont", value: String(emitter.iTipCont), enumType: "tiTipCont" },
      optionalElement("cTipReg", emitter.cTipReg),
      { name: "dNomEmi", value: emitter.dNomEmi },
      optionalElement("dNomFanEmi", emitter.dNomFanEmi),
      { name: "dDirEmi", value: emitter.dDirEmi },
      { name: "dNumCas", value: emitter.dNumCas },
      optionalElement("dCompDir1", emitter.dCompDir1),
      optionalElement("dCompDir2", emitter.dCompDir2),
      { name: "cDepEmi", value: emitter.cDepEmi },
      { name: "dDesDepEmi", value: emitter.dDesDepEmi },
      optionalElement("cDisEmi", emitter.cDisEmi),
      optionalElement("dDesDisEmi", emitter.dDesDisEmi),
      { name: "cCiuEmi", value: emitter.cCiuEmi },
      { name: "dDesCiuEmi", value: emitter.dDesCiuEmi },
      { name: "dTelEmi", value: emitter.dTelEmi },
      { name: "dEmailE", value: emitter.dEmailE },
      optionalElement("dDenSuc", emitter.dDenSuc),
      ...emitter.gActEco.map((activity): DteXmlElement => ({
        name: "gActEco",
        children: [
          { name: "cActEco", value: activity.cActEco },
          { name: "dDesActEco", value: activity.dDesActEco },
        ],
      })),
      emitter.gRespDE === undefined
        ? undefined
        : {
            name: "gRespDE",
            children: [
              { name: "iTipIDRespDE", value: String(emitter.gRespDE.iTipIDRespDE) },
              { name: "dDTipIDRespDE", value: emitter.gRespDE.dDTipIDRespDE },
              { name: "dNumIDRespDE", value: emitter.gRespDE.dNumIDRespDE },
              { name: "dNomRespDE", value: emitter.gRespDE.dNomRespDE },
              { name: "dCarRespDE", value: emitter.gRespDE.dCarRespDE },
            ],
          },
    ]),
  };
}

/**
 * `gDatRec` / `tgDatRec`, in schema order. The §22.11 conditions are enforced by
 * the validators; the builder only decides which optional members are present.
 */
function renderReceptor(receptor: DteReceptor): DteXmlElement {
  const identity: readonly (DteXmlElement | undefined)[] =
    receptor.iTipIDRec === undefined
      ? []
      : [
          { name: "iTipIDRec", value: String(receptor.iTipIDRec), enumType: "tiTipDocRec" },
          optionalElement("dDTipIDRec", receptor.dDTipIDRec),
          optionalElement("dNumIDRec", receptor.dNumIDRec),
        ];

  return {
    name: "gDatRec",
    children: compact([
      { name: "iNatRec", value: String(receptor.iNatRec), enumType: "tiNatRec" },
      { name: "iTiOpe", value: String(receptor.iTiOpe), enumType: "tiTiOpe" },
      { name: "cPaisRec", value: receptor.cPaisRec },
      { name: "dDesPaisRe", value: receptor.dDesPaisRe },
      optionalElement("iTiContRec", receptor.iTiContRec?.toString()),
      optionalElement("dRucRec", receptor.dRucRec),
      optionalElement("dDVRec", receptor.dDVRec),
      ...identity,
      { name: "dNomRec", value: receptor.dNomRec },
      optionalElement("dNomFanRec", receptor.dNomFanRec),
      optionalElement("dDirRec", receptor.dDirRec),
      optionalElement("dNumCasRec", receptor.dNumCasRec),
      optionalElement("cDepRec", receptor.cDepRec),
      optionalElement("dDesDepRec", receptor.dDesDepRec),
      optionalElement("cDisRec", receptor.cDisRec),
      optionalElement("dDesDisRec", receptor.dDesDisRec),
      optionalElement("cCiuRec", receptor.cCiuRec),
      optionalElement("dDesCiuRec", receptor.dDesCiuRec),
      optionalElement("dTelRec", receptor.dTelRec),
      optionalElement("dCelRec", receptor.dCelRec),
      optionalElement("dEmailRec", receptor.dEmailRec),
      optionalElement("dCodCliente", receptor.dCodCliente),
    ]),
  };
}

/** `gCamFuFD` / `tgCamFuFD`, emitted outside the signed `DE`. */
function renderCamposFueraFirma(campos: DteCamposFueraFirma, indent: number): string[] {
  return renderGroup(
    "gCamFuFD",
    [{ name: "dCarQR", value: campos.dCarQR }, optionalElement("dInfAdic", campos.dInfAdic)],
    indent
  );
}

function renderOptionalGroup(
  name: string,
  elements: readonly DteXmlElement[] | undefined,
  indent: number
): string[] {
  return elements === undefined ? [] : renderGroup(name, elements, indent);
}

function renderGroup(
  name: string,
  elements: readonly (DteXmlElement | undefined)[],
  indent: number
): string[] {
  return renderElement({ name, children: compact(elements) }, indent);
}

function renderElement(element: DteXmlElement, indent: number): string[] {
  const prefix = " ".repeat(indent);
  const children = element.children ?? [];
  if (children.length > 0) {
    return [
      `${prefix}<${element.name}>`,
      ...children.flatMap((child) => renderElement(child, indent + 2)),
      `${prefix}</${element.name}>`,
    ];
  }
  if (element.value !== undefined) {
    return [`${prefix}<${element.name}>${escapeXmlText(element.value)}</${element.name}>`];
  }
  return [`${prefix}<${element.name}/>`];
}

function optionalElement(name: string, value: string | undefined): DteXmlElement | undefined {
  return value === undefined ? undefined : { name, value };
}

function compact(elements: readonly (DteXmlElement | undefined)[]): readonly DteXmlElement[] {
  return elements.filter((element): element is DteXmlElement => element !== undefined);
}

function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
