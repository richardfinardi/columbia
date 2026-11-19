"""
Columbia / Conferência de Revenda.
Rota de escrita segura para o cadastro fiscal de materiais da família 20.

Este módulo NÃO sobe sozinho. Instale no FastAPI da Columbia chamando
build_revenda_router(user_dependency=..., connection_factory=...).
A permissão vem da mesma autenticação Bearer usada no portal Columbia.

Compatibilidade: PostgreSQL com conexão DB-API 2.0 (psycopg2/psycopg).
Não recebe SQL, empresa ou descrição fiscal do navegador: tudo é validado
no banco antes do UPDATE, na mesma transação.
"""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

LOGGER = logging.getLogger("columbia.revenda")
COLUMNS = (
    "cod_classificacao_fiscal",
    "classificacao_fiscal",
    "descricao_classi_fiscal",
    "ipi",
    "cean_i03",
    "cbenef_i05f",
    "cclass_trib_ibscbs",
    "desc_cclass_trib_ibscbs",
    "u_revisado",
)
SELECT_PRODUTO = """
SELECT cod_classificacao_fiscal, classificacao_fiscal,
       descricao_classi_fiscal, ipi, cean_i03, cbenef_i05f,
       cclass_trib_ibscbs, desc_cclass_trib_ibscbs, u_revisado
FROM tproduto
WHERE codigo = %s
  AND cod_empresa = 1
  AND cod_familia = 20
  AND metodo_reposicao = 0
  AND inativo = 0
FOR UPDATE
"""
SELECT_NCM = """
SELECT codigo, numero, descricao, ipi
FROM tcla_fis
WHERE BTRIM(codigo::text) = %s
LIMIT 1
"""
SELECT_CBS = """
SELECT codigo_cclastrib, descricao
FROM tclasstrib_cbsibs
WHERE codigo_cclastrib = %s
LIMIT 1
"""
UPDATE_PRODUTO = """
UPDATE tproduto SET
    cod_classificacao_fiscal = %s,
    classificacao_fiscal = %s,
    descricao_classi_fiscal = %s,
    ipi = %s,
    cean_i03 = %s,
    cbenef_i05f = %s,
    cclass_trib_ibscbs = %s,
    desc_cclass_trib_ibscbs = %s,
    u_revisado = %s
WHERE codigo = %s
  AND cod_empresa = 1
  AND cod_familia = 20
  AND metodo_reposicao = 0
  AND inativo = 0
RETURNING codigo, u_revisado
"""


class RevendaUpdate(BaseModel):
    codigo: int = Field(gt=0)
    ncm_codigo: str | int
    cbs_codigo: str | None = Field(default=None, max_length=40)
    cean_i03: str = Field(default="", max_length=30)
    cbenef_i05f: str = Field(default="", max_length=50)
    revisado: bool
    # Snapshot dos nove campos vistos antes de abrir o editor.
    # Evita que a aba de outro usuário sobrescreva alterações recentes.
    esperado: dict[str, Any]


def get_permission(user: Any) -> int:
    if isinstance(user, dict):
        fields = {str(k).lower(): v for k, v in user.items()}
        raw = fields.get("u_analista_cadastro", 0)
    else:
        raw = getattr(user, "u_analista_cadastro", 0)
    try:
        return int(raw or 0)
    except (ValueError, TypeError):
        return 0


def equivalent(key: str, actual: Any, expected: Any) -> bool:
    if key in {"ipi", "u_revisado", "cod_classificacao_fiscal"}:
        try:
            a = Decimal(str(actual if actual not in (None, "") else 0).replace(",", "."))
            b = Decimal(str(expected if expected not in (None, "") else 0).replace(",", "."))
            return a == b
        except (InvalidOperation, ValueError):
            return False
    return str(actual if actual is not None else "").strip() == str(
        expected if expected is not None else ""
    ).strip()


def verified_snapshot(row: tuple, expected: dict[str, Any]) -> bool:
    # Exigir todos os campos evita um snapshot vazio contornar a proteção.
    if not all(key in expected for key in COLUMNS):
        return False
    return all(equivalent(key, row[index], expected[key]) for index, key in enumerate(COLUMNS))


def normalize_optional(value: str | None) -> str:
    return (value or "").strip()


def build_revenda_router(
    *,
    user_dependency: Callable,
    connection_factory: Callable,
) -> APIRouter:
    """
    user_dependency: a validação Bearer existente do portal Columbia.
      Deve retornar permissões REAIS do CSENHA, inclusive u_analista_cadastro.
    connection_factory: callable síncrono que cria conexão PostgreSQL exclusiva
      para a requisição (com commit, rollback, cursor e close).
    """
    router = APIRouter(tags=["columbia-revenda"])

    @router.post("/revenda/atualizar")
    def atualizar_revenda(payload: RevendaUpdate, user: Any = Depends(user_dependency)):
        if get_permission(user) != 1:
            raise HTTPException(status_code=403, detail="Sem permissão para conferir materiais de revenda.")

        gtin = payload.cean_i03.strip()
        codigo_cbs = normalize_optional(payload.cbs_codigo)
        if codigo_cbs and len(codigo_cbs) > 40:
            raise HTTPException(status_code=422, detail="Código CBS/IBS inválido.")

        connection = None
        try:
            connection = connection_factory()
            # SELECT FOR UPDATE precisa estar na mesma transação do UPDATE.
            if hasattr(connection, "autocommit"):
                connection.autocommit = False
            with connection.cursor() as cursor:
                cursor.execute(SELECT_PRODUTO, (payload.codigo,))
                original = cursor.fetchone()
                if original is None:
                    raise HTTPException(
                        status_code=404, detail="Material não encontrado na família de revenda ativa."
                    )
                if not verified_snapshot(original, payload.esperado):
                    raise HTTPException(
                        status_code=409,
                        detail="Este material foi modificado após a consulta. Atualize os dados antes de salvar.",
                    )

                ncm_codigo = str(payload.ncm_codigo if payload.ncm_codigo is not None else '').strip()
                if not ncm_codigo or len(ncm_codigo) > 64:
                    raise HTTPException(status_code=422, detail='Código interno do NCM inválido.')
                cursor.execute(SELECT_NCM, (ncm_codigo,))
                fiscal = cursor.fetchone()
                if fiscal is None:
                    raise HTTPException(status_code=422, detail="NCM não cadastrado na tabela fiscal do CPS.")
                ncm_id, ncm_numero, ncm_descricao, ncm_ipi = fiscal
                if not str(ncm_numero or "").strip():
                    raise HTTPException(status_code=422, detail="O NCM selecionado está sem número.")

                if codigo_cbs:
                    cursor.execute(SELECT_CBS, (codigo_cbs,))
                    cbs = cursor.fetchone()
                    if cbs is None:
                        raise HTTPException(status_code=422, detail="Código CBS/IBS não cadastrado no CPS.")
                    cbs_id, cbs_descricao = cbs
                else:
                    cbs_id, cbs_descricao = "", ""

                cursor.execute(
                    UPDATE_PRODUTO,
                    (
                        ncm_id,
                        str(ncm_numero).strip(),
                        str(ncm_descricao or "").strip(),
                        ncm_ipi,
                        gtin,
                        payload.cbenef_i05f.strip(),
                        str(cbs_id or "").strip(),
                        str(cbs_descricao or "").strip(),
                        int(payload.revisado),
                        payload.codigo,
                    ),
                )
                saved = cursor.fetchone()
                if saved is None:
                    raise HTTPException(status_code=409, detail="Material não pôde ser atualizado.")
            connection.commit()
            LOGGER.info("Conferência Revenda: material %s gravado, revisado=%s", payload.codigo, payload.revisado)
            return {"ok": True, "codigo": int(saved[0]), "u_revisado": int(saved[1] or 0)}
        except HTTPException:
            if connection is not None:
                connection.rollback()
            raise
        except Exception:
            if connection is not None:
                connection.rollback()
            LOGGER.exception("Erro ao atualizar material revenda id=%s", payload.codigo)
            raise HTTPException(status_code=500, detail="Erro ao gravar cadastro no CPS.")
        finally:
            if connection is not None:
                connection.close()

    return router
