"""Gerenciador de acessos CSENHA para o portal Columbia.
Arquivo independente: nao altera as rotas ja existentes em api.py.
Instalar: from permissoes_columbia import router as permissoes_router
          app.include_router(permissoes_router)
"""
import logging
import os

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from starlette.concurrency import run_in_threadpool

from auth import ALGORITHM, SECRET_KEY
from conexao import get_conn

router = APIRouter(tags=["Permissoes Columbia"])
_bearer = HTTPBearer(auto_error=False)
_log = logging.getLogger("permissoes_columbia")

CAMPOS = (
    "u_analista_cadastro",
    "u_anexo",
    "u_custos",
    "u_engenharia",
    "u_faturamento",
    "u_finalizacao",
    "u_notas",
    "u_pcp",
    "u_vendedor",
    "u_horas",
    "u_gestor",
)
COLUNAS = ", ".join(c.upper() for c in CAMPOS)
ENGINE_SQLSERVER = str(os.getenv("DB_ENGINE", "1")).strip().lower() in ("2", "sqlserver", "mssql")
PARAM = "?" if ENGINE_SQLSERVER else "%s"
FILTRO_ATIVO = "COD_EMPRESA = 1 AND (INATIVO = 0 OR INATIVO IS NULL)"


def flag(v):
    return 1 if str(v).strip().lower() in ("1", "true", "t") else 0


def usuario_do_token(credentials):
    if not credentials or not credentials.credentials:
        raise HTTPException(401, "Sessao nao informada. Entre novamente.")
    try:
        dados = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        nome = str(dados.get("sub") or "").strip().upper()
        if not nome:
            raise ValueError("Token sem usuario")
        return nome
    except (JWTError, ValueError):
        raise HTTPException(401, "Sessao invalida ou expirada. Entre novamente.")


def _consulta_gestor(nome):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT CODIGO, U_GESTOR FROM CSENHA WHERE {FILTRO_ATIVO} "
            f"AND UPPER(TRIM(NOME)) = {PARAM}", (nome,)
        )
        rows = cur.fetchall()
        cur.close()
        # Nao escolher arbitrariamente entre cadastros duplicados.
        if len(rows) != 1:
            return False
        return flag(rows[0][1]) == 1
    finally:
        conn.close()


async def _exigir_gestor(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
):
    nome = usuario_do_token(credentials)
    try:
        habilitado = await run_in_threadpool(_consulta_gestor, nome)
    except Exception:
        _log.exception("Falha ao validar gestor CSENHA")
        raise HTTPException(503, "Nao foi possivel validar o perfil gestor no banco.")
    if not habilitado:
        raise HTTPException(403, "Acesso restrito a CSENHA.U_GESTOR = 1.")
    return nome


@router.get("/permissoes/me")
@router.get("/producao/permissoes/me")
async def permissao_gestor_atual(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
):
    nome = usuario_do_token(credentials)
    try:
        gestor = await run_in_threadpool(_consulta_gestor, nome)
    except Exception:
        _log.exception("Falha ao consultar perfil gestor")
        raise HTTPException(503, "Nao foi possivel consultar seu perfil de acesso.")
    return {"usuario": nome, "u_gestor": 1 if gestor else 0}


def _listar_usuarios():
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT CODIGO, TRIM(NOME), {COLUNAS} FROM CSENHA "
            f"WHERE {FILTRO_ATIVO} ORDER BY NOME, CODIGO"
        )
        rows = cur.fetchall()
        cur.close()
        return [
            {
                "codigo": int(r[0]),
                "usuario": str(r[1] or "").strip(),
                **{campo: flag(r[i + 2]) for i, campo in enumerate(CAMPOS)},
            }
            for r in rows
        ]
    finally:
        conn.close()


@router.get("/permissoes/usuarios")
@router.get("/producao/permissoes/usuarios")
async def listar_usuarios(gestor: str = Depends(_exigir_gestor)):
    try:
        usuarios = await run_in_threadpool(_listar_usuarios)
    except Exception:
        _log.exception("Falha ao listar CSENHA")
        raise HTTPException(503, "Nao foi possivel consultar os usuarios.")
    return {"usuarios": usuarios}


def _salvar_usuario(codigo: int, alteracoes: dict, gestor: str):
    conn = get_conn()
    try:
        cur = conn.cursor()
        # Bloqueia os registros ativos durante a alteracao. Impede duas sessoes
        # de removerem simultaneamente o ultimo gestor.
        if ENGINE_SQLSERVER:
            cur.execute(
                f"SELECT CODIGO, TRIM(NOME), U_GESTOR FROM CSENHA "
                f"WITH (UPDLOCK, HOLDLOCK) WHERE {FILTRO_ATIVO} ORDER BY CODIGO"
            )
        else:
            cur.execute(
                f"SELECT CODIGO, TRIM(NOME), U_GESTOR FROM CSENHA "
                f"WHERE {FILTRO_ATIVO} ORDER BY CODIGO FOR UPDATE"
            )
        rows = cur.fetchall()
        autores = [r for r in rows if str(r[1] or "").strip().upper() == gestor]
        if len(autores) != 1 or flag(autores[0][2]) != 1:
            raise HTTPException(403, "Sua permissao de gestor foi revogada.")
        alvo = next((r for r in rows if int(r[0]) == codigo), None)
        if alvo is None:
            raise HTTPException(404, "Usuario nao encontrado ou inativo.")

        gestores = sum(flag(r[2]) for r in rows)
        if (
            "u_gestor" in alteracoes
            and flag(alvo[2]) == 1
            and alteracoes["u_gestor"] == 0
            and gestores <= 1
        ):
            raise HTTPException(409, "Nao e permitido remover o ultimo gestor ativo.")

        nomes = list(alteracoes)
        sql = (
            "UPDATE CSENHA SET " + ", ".join(c.upper() + " = " + PARAM for c in nomes)
            + f" WHERE CODIGO = {PARAM} AND {FILTRO_ATIVO}"
        )
        cur.execute(sql, tuple(alteracoes[c] for c in nomes) + (codigo,))
        conn.commit()
        cur.close()
        _log.info(
            "CSENHA acessos atualizados por %s, usuario codigo %s, campos %s",
            gestor, codigo, ",".join(nomes),
        )
        return {"ok": True, "codigo": codigo, "campos": alteracoes}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@router.patch("/permissoes/usuarios/{codigo}")
@router.patch("/producao/permissoes/usuarios/{codigo}")
async def salvar_usuario(
    codigo: int,
    alteracoes: dict = Body(...),
    gestor: str = Depends(_exigir_gestor),
):
    if codigo <= 0:
        raise HTTPException(422, "Codigo de usuario invalido.")
    if not isinstance(alteracoes, dict) or not alteracoes:
        raise HTTPException(422, "Informe pelo menos uma permissao.")
    if any(k not in CAMPOS for k in alteracoes):
        raise HTTPException(422, "Campo de permissao desconhecido.")
    if any(type(v) is not int or v not in (0, 1) for v in alteracoes.values()):
        raise HTTPException(422, "As permissoes devem ser 0 ou 1.")
    try:
        return await run_in_threadpool(_salvar_usuario, codigo, alteracoes, gestor)
    except HTTPException:
        raise
    except Exception:
        _log.exception("Falha ao gravar CSENHA para codigo %s", codigo)
        raise HTTPException(503, "Nao foi possivel gravar as permissoes no banco.")
