"""
Columbia PCP: links públicos com validade e consulta somente leitura.

Instalação: importar build_pcp_router no servidor FastAPI da Columbia e passar:
- pcp_user_dependency: Depends(...) já existente que autentica o Bearer e devolve
  usuário com campo u_pcp=1 (o router também verifica u_pcp).
- rows_provider: função (sync/async) que retorna os registros do JSON atual da Produção.
- pdf_provider: função (sync/async) (cod_empresa, cod_os, cod_os_aux) -> PDF
  em bytes ou dict {"pdf_base64":"..."}. Usa a fonte interna da Produção.
Nada aqui precisa ser aberto sem autenticação, exceto os endpoints GET por link,
que exigem token aleatório e checam sua validade.
"""

from __future__ import annotations

import base64
import hashlib
import inspect
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

ALLOWED_DAYS = {0, 7, 30, 90, 365}
MAX_OS = 5000
MAX_PDF_SIZE = 25 * 1024 * 1024
OS_PATTERN = re.compile(r"^[A-Za-z0-9_./-]{1,45}$")
PUBLIC_BASE = os.environ.get(
    "COLUMBIA_PCP_PORTAL_URL",
    "https://consultoriarf.net/columbia/pcp/portal.html",
)


class PortalCreate(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    validade_dias: int = 30
    mostrar_valores: bool = True
    permitir_excel: bool = False
    os: list[str]


class StatusChange(BaseModel):
    ativo: bool


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


def clean(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s.lower() in {"", "nat", "nan", "none", "null"} else s


def pick(d: dict, *names: str) -> Any:
    for name in names:
        v = d.get(name.lower())
        if clean(v):
            return v
    return None


def iso_date(v: Any) -> str:
    s = clean(v)
    if not s:
        return ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, month, day = map(int, m.groups())
    else:
        m = re.match(r"^(\d{2})/(\d{2})/(\d{4})", s)
        if not m:
            return ""
        day, month, y = map(int, m.groups())
    try:
        return datetime(y, month, day).date().isoformat()
    except ValueError:
        return ""


def numeric(v: Any) -> float | None:
    if not clean(v):
        return None
    if isinstance(v, (float, int)):
        return float(v)
    s = re.sub(r"\s|R\$", "", str(v))
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def attached(row: dict) -> list[dict]:
    raw = row.get("anexos")
    if not isinstance(raw, list):
        return []
    output, seen = [], set()
    for source in raw:
        if not isinstance(source, dict):
            continue
        a = {str(k).lower(): v for k, v in source.items()}
        empresa = clean(pick(a, "cod_empresa") or row.get("cod_empresa"))
        os_id = clean(pick(a, "cod_os") or row.get("cod_os"))
        aux = clean(pick(a, "cod_os_aux", "cod_aux"))
        if not all(x.isdecimal() for x in (empresa, os_id, aux)):
            continue
        key = (empresa, os_id, aux)
        if key in seen:
            continue
        seen.add(key)
        output.append({
            "empresa": empresa,
            "cod_os": os_id,
            "aux": aux,
            "nome": clean(pick(a, "nome_arquivo", "titulo", "descricao", "codigo")),
        })
    return output


def normalize(source: Any, include_value: bool) -> dict | None:
    if not isinstance(source, dict):
        return None
    r = {str(k).lower(): v for k, v in source.items()}
    os_number = clean(pick(r, "n_os", "numero_os"))
    if not os_number:
        return None
    item = {
        "os": os_number,
        "orc": clean(pick(r, "n_orcamento", "orcamento", "numero_orcamento")),
        "item": clean(pick(r, "titulo", "descricao", "cod_interno", "tiposervico")),
        "cliente": clean(pick(r, "cliente", "nome_cliente")),
        "segmento": clean(pick(r, "segmento", "segmento_cliente", "u_segmento", "classificacao_segmento")),
        "original": iso_date(pick(r, "prev_entrega_os", "dt_previsao_entrega", "dt_prevista")),
        "reneg": iso_date(pick(r, "dt_renegociada", "u_data_renegociacao")),
        "pend": clean(pick(r, "pp_pendentes", "processos_pendentes")),
        "anexos": attached(r),
    }
    if include_value:
        item["valor"] = numeric(pick(r, "preco_geral_a_vista", "valor", "vl_a_faturar"))
    return item


def open_db(db_path: str):
    con = sqlite3.connect(db_path, timeout=20)
    con.row_factory = sqlite3.Row
    return con


def setup_db(db_path: str):
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    with open_db(db_path) as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS pcp_portals (
                id TEXT PRIMARY KEY,
                token TEXT NOT NULL,
                nome TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                show_values INTEGER NOT NULL DEFAULT 1,
                allow_excel INTEGER NOT NULL DEFAULT 0,
                os_json TEXT NOT NULL,
                visits INTEGER NOT NULL DEFAULT 0,
                last_access TEXT
            )
        """)


def build_pcp_router(
    pcp_user_dependency: Callable,
    rows_provider: Callable,
    pdf_provider: Callable,
    db_path: str | None = None,
) -> APIRouter:
    """Cria rotas PCP no mesmo app FastAPI que já atende a Produção Columbia.

    Nunca passar uma dependência que apenas devolve valores do localStorage:
    pcp_user_dependency DEVE validar credenciais no servidor.
    """
    if not all(callable(x) for x in (pcp_user_dependency, rows_provider, pdf_provider)):
        raise ValueError("É necessário fornecer validação de usuário, fonte de OS e fonte de PDF.")

    db_path = db_path or os.environ.get("COLUMBIA_PCP_PORTAL_DB", "dados/columbia_pcp_portals.sqlite3")
    setup_db(db_path)
    router = APIRouter(prefix="/producao/pcp", tags=["Planejamento PCP"])

    async def resolved(fn, *args):
        result = fn(*args)
        return await result if inspect.isawaitable(result) else result

    def pcp_check(user=Depends(pcp_user_dependency)):
        if isinstance(user, dict):
            access = user.get("u_pcp")
            identity = user.get("usuario") or user.get("username") or user.get("sub")
        else:
            access = getattr(user, "u_pcp", None)
            identity = (getattr(user, "usuario", None) or getattr(user, "username", None)
                        or getattr(user, "sub", None))
        if str(access) != "1" or not identity:
            raise HTTPException(403, "Usuário sem permissão para gerenciar os planejamentos.")
        return str(identity)

    def lookup(id: str, token: str) -> dict:
        # Tanto data quanto PDF devem passar por esta verificação.
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,100}", id):
            raise HTTPException(404, "Planejamento não encontrado.")
        if not re.fullmatch(r"[A-Za-z0-9_-]{20,150}", token):
            raise HTTPException(404, "Link inválido.")
        with open_db(db_path) as con:
            item = con.execute("SELECT * FROM pcp_portals WHERE id = ?", (id,)).fetchone()
        if item is None:
            raise HTTPException(404, "Planejamento não encontrado.")
        p = dict(item)
        if not secrets.compare_digest(
            hashlib.sha256(p["token"].encode("utf-8")).digest(),
            hashlib.sha256(token.encode("utf-8")).digest(),
        ):
            raise HTTPException(404, "Link inválido.")
        if not p["active"] or (p["expires_at"] and datetime.fromisoformat(p["expires_at"]) <= utc_now()):
            raise HTTPException(410, "Este link expirou ou foi desativado.")
        return p

    def metadata(p: dict, include_url: bool = False) -> dict:
        data = {
            "id": p["id"], "nome": p["nome"],
            "ativo": bool(p["active"]),
            "validade_ate": p["expires_at"],
            "criado_em": p["created_at"],
            "mostrar_valores": bool(p["show_values"]),
            "permitir_excel": bool(p["allow_excel"]),
            "qtd_os": len(json.loads(p["os_json"])),
            "qtd_acessos": p["visits"],
        }
        if include_url:
            data["url"] = PUBLIC_BASE + "?" + urlencode({"id": p["id"], "token": p["token"]})
        return data

    @router.post("/portal")
    async def create_portal(form: PortalCreate, user: str = Depends(pcp_check)):
        if form.validade_dias not in ALLOWED_DAYS:
            raise HTTPException(422, "Escolha uma validade de 7, 30, 90, 365 dias ou sem vencimento.")
        os_list = list(dict.fromkeys(clean(x) for x in form.os))
        if not os_list or len(os_list) > MAX_OS or any(not OS_PATTERN.fullmatch(x) for x in os_list):
            raise HTTPException(422, "Seleção inválida de ordens de serviço.")
        # Evita publicar OS não existentes ou não consultáveis, mesmo com um POST manipulado.
        raw = await resolved(rows_provider)
        valid = {clean(x.get("n_os")) for x in raw if isinstance(x, dict)}
        if not set(os_list).issubset(valid):
            raise HTTPException(422, "Há ordens de serviço que não foram encontradas no planejamento.")
        now = utc_now()
        expiry = now + timedelta(days=form.validade_dias) if form.validade_dias else None
        identity = secrets.token_urlsafe(12)
        token = secrets.token_urlsafe(32)
        with open_db(db_path) as con:
            con.execute(
                """INSERT INTO pcp_portals
                (id,token,nome,created_by,created_at,expires_at,active,show_values,allow_excel,os_json)
                VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (identity, token, form.nome.strip(), user, iso(now), iso(expiry), 1,
                 int(form.mostrar_valores), int(form.permitir_excel), json.dumps(os_list)),
            )
        with open_db(db_path) as con:
            p = dict(con.execute("SELECT * FROM pcp_portals WHERE id=?", (identity,)).fetchone())
        return {"portal": {**metadata(p, True), "token": token}}

    @router.get("/portais")
    async def list_portals(_user: str = Depends(pcp_check)):
        with open_db(db_path) as con:
            saved = con.execute("SELECT * FROM pcp_portals ORDER BY created_at DESC LIMIT 200").fetchall()
        return [metadata(dict(p), True) for p in saved]

    @router.patch("/portal/{id}/status")
    async def change_status(id: str, form: StatusChange, _user: str = Depends(pcp_check)):
        with open_db(db_path) as con:
            result = con.execute("UPDATE pcp_portals SET active=? WHERE id=?", (int(form.ativo), id))
            if not result.rowcount:
                raise HTTPException(404, "Planejamento não encontrado.")
        return {"id": id, "ativo": form.ativo}

    @router.get("/portal/{id}/dados")
    async def portal_data(id: str, token: str):
        portal = lookup(id, token)
        selected = set(json.loads(portal["os_json"]))
        raw = await resolved(rows_provider)
        if not isinstance(raw, list):
            raise HTTPException(503, "Não foi possível consultar os dados atuais.")
        by_os: dict[str, dict] = {}
        for item in raw:
            row = normalize(item, include_value=bool(portal["show_values"]))
            if row is None or row["os"] not in selected:
                continue
            if row["os"] not in by_os:
                by_os[row["os"]] = row
            else:
                previous = by_os[row["os"]]
                for key in ("item","orc","cliente","segmento","original","reneg","pend"):
                    if not previous[key] and row[key]:
                        previous[key] = row[key]
                existing = {a["aux"] for a in previous["anexos"]}
                previous["anexos"].extend(a for a in row["anexos"] if a["aux"] not in existing)
        # Não expõe códigos internos de empresa, usuário, processo ou API.
        dados = [by_os[os] for os in json.loads(portal["os_json"]) if os in by_os]
        for r in dados:
            r["anexos"] = [{"aux": a["aux"], "nome": a["nome"]} for a in r["anexos"]]
        with open_db(db_path) as con:
            con.execute("UPDATE pcp_portals SET visits=visits+1,last_access=? WHERE id=?", (iso(utc_now()), id))
        return {"portal": metadata(portal), "dados": dados, "atualizado_em": iso(utc_now())}

    @router.get("/portal/{id}/anexo")
    async def portal_attachment(id: str, token: str, os: str, aux: str):
        portal = lookup(id, token)
        allowed_os = set(json.loads(portal["os_json"]))
        if os not in allowed_os or not aux.isdecimal():
            raise HTTPException(404, "Desenho técnico não encontrado.")
        raw = await resolved(rows_provider)
        match = None
        for item in raw:
            if not isinstance(item, dict):
                continue
            lower = {str(k).lower(): v for k,v in item.items()}
            if clean(pick(lower, "n_os", "numero_os")) != os:
                continue
            match = next((a for a in attached(lower) if a["aux"] == aux), None)
            if match:
                break
        if not match:
            raise HTTPException(404, "Desenho técnico não encontrado para esta OS.")
        source = await resolved(pdf_provider, match["empresa"], match["cod_os"], match["aux"])
        if isinstance(source, bytes):
            pdf = source
        else:
            value = source.get("pdf_base64") if isinstance(source, dict) else source
            if not isinstance(value, str):
                raise HTTPException(502, "Não foi possível obter o desenho técnico.")
            try:
                value = re.sub(r"^data:application/pdf;base64,", "", value, flags=re.I)
                pdf = base64.b64decode(value, validate=True)
            except (ValueError, base64.binascii.Error):
                raise HTTPException(502, "Arquivo PDF inválido.")
        if not pdf.startswith(b"%PDF") or len(pdf) > MAX_PDF_SIZE:
            raise HTTPException(502, "Arquivo PDF inválido ou muito grande.")
        return Response(
            content=pdf, media_type="application/pdf",
            headers={
                "Content-Disposition": 'inline; filename="desenho_os_' + os.replace("/","_") + '_' + aux + '.pdf"',
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
            }
        )

    return router
