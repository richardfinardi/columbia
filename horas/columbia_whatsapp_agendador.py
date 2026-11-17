"""
COLUMBIA | Agendador de Fechamento de Horas via WhatsApp AUVRIUN
Executa no próprio servidor Windows onde api.py, auth.py e horas_disponiveis_columbia.py estão instalados.

Não envia sem a chave de aplicação e uma conta de serviço válida com CSENHA.U_HORAS=1.
Não guarda CPFs, senhas ou dados pessoais no GitHub.
Nenhuma mensagem é enviada com --preview.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

APP_ID = "columbia"
EVENT_ID = "fechamento_horas"
BASE = os.getenv("COLUMBIA_LOCAL_API", "http://127.0.0.1:8000").rstrip("/")
WHATSAPP_BASE = os.getenv(
    "AUVRIUN_WHATSAPP_URL",
    "https://auvriun-whatsapp.auvriun-monitor.workers.dev/whatsapp",
).rstrip("/")
try:
    TZ = ZoneInfo("America/Sao_Paulo")
except ZoneInfoNotFoundError:
    TZ = timezone(timedelta(hours=-3))  # Brasil sem horário de verão desde 2019
ROOT = Path(os.getenv("COLUMBIA_WHATSAPP_DATA", str(Path(__file__).resolve().parent / "whatsapp_horas_dados")))
LOG = logging.getLogger("columbia.whatsapp")
MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
          "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
MAX_MESSAGE = 3750


def normalize(value: Any) -> str:
    txt = unicodedata.normalize("NFKD", str(value or ""))
    return re.sub(r"[^a-z0-9]", "", "".join(
        c for c in txt if not unicodedata.combining(c)).lower())


def record(row: dict) -> dict:
    return {normalize(k): v for k, v in row.items()}


def pick(row: dict, *keys: str) -> Any:
    for key in keys:
        value = row.get(normalize(key))
        if value is not None and value != "":
            return value
    return None


def hours(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if value is None or value == "":
        return 0.0
    raw = str(value).strip().replace(" ", "")
    match = re.fullmatch(r"(\d{1,4}):(\d{2})", raw)
    if match:
        return int(match[1]) + int(match[2]) / 60
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".")
    try:
        return float(raw)
    except (ValueError, TypeError):
        return 0.0


def date_from(value: Any) -> tuple[date | None, bool]:
    if isinstance(value, datetime):
        return value.date(), True
    if isinstance(value, date):
        return value, True
    text = str(value or "").strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            if len(text) >= 10:
                return datetime.strptime(text[:10], pattern).date(), True
        except ValueError:
            continue
    match = re.match(r"^(20\d{2})[-/]?(0?[1-9]|1[0-2])$", text)
    if match:
        return date(int(match[1]), int(match[2]), 1), False
    return None, False


def grv_row(row: dict) -> dict:
    obj = record(row)
    day, actual_date = date_from(pick(obj, "data", "data_apontamento", "dt_apontamento",
         "dt_inicio", "data_inicio", "dataaponta", "dt_inicio_producao", "data_aponta",
         "dt_producao", "data_lancamento", "dt_data", "dia", "dataref", "dt_ref",
         "datahora", "data_hora"))
    if day is None:
        day, _ = date_from(pick(obj, "ano_mes", "anomes", "mes_ano", "competencia", "periodo"))
    employee = str(pick(obj, "funcionario", "nome_funcionario", "colaborador", "operador",
         "nome", "nm_funcionario", "funcionario_nome", "nome_colaborador",
         "responsavel", "recurso_humano") or "").strip()
    segment = str(pick(obj, "seguimento", "segmento", "nome_segmento", "grupo_maquina",
         "setor", "departamento", "centro_custo", "centrocusto") or "Sem segmento").strip()
    machine = str(pick(obj, "maquina", "nome_maquina", "recurso", "equipamento",
         "descricao_maquina", "tp_maquina", "maquina_nome") or "Não informado").strip()
    total_raw = pick(obj, "horas_apontadas", "horas", "horas_trabalhadas", "qtd_horas",
         "qtde_horas", "quantidade_horas", "total_horas", "horas_realizadas",
         "tempo_total", "tempo", "qtde", "quantidade")
    prod_raw = pick(obj, "horas_produtivas", "produtivas", "hr_produtiva",
         "horas_producao", "horas_prod", "tempo_produtivo", "horas_produtiva")
    stop_raw = pick(obj, "horas_paradas", "paradas", "horas_parada", "hr_paradas",
         "tempo_parada", "horas_improdutivas", "tempo_improdutivo")
    total = hours(total_raw) if total_raw is not None else None
    prod = hours(prod_raw) if prod_raw is not None else 0.0
    stop = hours(stop_raw) if stop_raw is not None else 0.0
    if prod_raw is None and stop_raw is None and total is not None:
        description = normalize(pick(obj, "tipo_apontamento", "classificacao", "tipo_servico",
             "tipo_hora", "natureza", "tipo", "descricao_tp_maquina", "tp_maquina", "status", "situacao"))
        if re.search("parad|setup|aguard|ocios|improdut|manutenc|interrup", description):
            stop = total
        else:
            prod = total
    elif total is not None and prod_raw is None:
        prod = max(0.0, total - stop)
    elif total is not None and stop_raw is None:
        stop = max(0.0, total - prod)
    return {"day": day, "actual_date": actual_date, "employee": employee,
            "person": normalize(employee), "segment": segment, "machine": machine,
            "total": max(0.0, total if total is not None else prod + stop),
            "prod": max(0.0, prod), "stop": max(0.0, stop),
            "recognized": total_raw is not None or prod_raw is not None or stop_raw is not None}


def actual_date(event: dict) -> date | None:
    return date_from(event.get("data"))[0]


def event_availability(events: list[dict], start: date, end: date) -> dict[str, float]:
    """Resume por funcionário E dia, evitando duplicar extras total x detalhadas."""
    from horas_disponiveis_columbia import _hours, _kind
    by_person_day: dict[tuple[str, date], dict] = defaultdict(
        lambda: {"normal": 0.0, "extra_total": 0.0, "extra_detail": 0.0, "has_detail": False})
    for event in events:
        day = actual_date(event)
        if day is None:
            raise ValueError("Aponta Fácil não forneceu data válida por evento. Envio suspenso.")
        if not start <= day <= end:
            continue
        person = normalize(event.get("nome"))
        if not person:
            continue
        kind = _kind(str(event.get("descricao_evento") or ""))
        qty = _hours(event.get("quantidade_caculada", event.get("quantidade_calculada", 0)))
        if qty < 0:
            continue
        bucket = by_person_day[(person, day)]
        if kind == "normal":
            bucket["normal"] += qty
        elif kind == "extra_total":
            bucket["extra_total"] += qty
        elif kind == "extra_detail":
            bucket["extra_detail"] += qty
            bucket["has_detail"] = True
    totals: dict[str, float] = defaultdict(float)
    for (person, _), b in by_person_day.items():
        totals[person] += b["normal"] + (b["extra_detail"] if b["has_detail"] else b["extra_total"])
    return dict(totals)


def months_between(start: date, end: date) -> list[tuple[int, int]]:
    result = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        result.append((y, m))
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
    return result


async def get_events(start: date, end: date) -> list[dict]:
    from horas_disponiveis_columbia import _read_events
    token = os.environ.get("APONTAFACIL_TOKEN", "").strip()
    if not token:
        raise RuntimeError("APONTAFACIL_TOKEN não encontrado no ambiente deste processo")
    ROOT.mkdir(parents=True, exist_ok=True)
    all_events = []
    for year, month in months_between(start, end):
        cache = ROOT / f"apontafacil_{year}_{month:02d}.json"
        is_closed = (year, month) < (datetime.now(TZ).year, datetime.now(TZ).month)
        if is_closed and cache.is_file():
            data = json.loads(cache.read_text(encoding="utf-8"))
        else:
            data = await _read_events(year, month, token)
            # Congelamento de mês fechado só depois de consulta completa e válida.
            if is_closed:
                tmp = cache.with_suffix(".tmp")
                tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                tmp.replace(cache)
        all_events.extend(data)
    return all_events


def from_api(result: Any) -> list[dict]:
    if isinstance(result, list):
        return result
    if not isinstance(result, dict):
        return []
    for k in ("apontamentos", "dados_apontamentos", "custos_apontamento", "data", "dados", "registros", "rows", "items"):
        value = result.get(k)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for nested in ("data", "dados", "registros", "rows", "items"):
                if isinstance(value.get(nested), list):
                    return value[nested]
    return []


async def get_grv() -> list[dict]:
    user = os.environ.get("COLUMBIA_HORAS_SERVICE_USER", "").strip()
    if not user:
        raise RuntimeError("Defina COLUMBIA_HORAS_SERVICE_USER (usuário ativo com U_HORAS=1)")
    # Validação no banco, não confiar apenas em um nome digitado no .bat.
    from horas_disponiveis_columbia import _check_u_horas
    from auth import criar_token_acesso
    _check_u_horas(user)
    token = criar_token_acesso({"sub": user})
    async with httpx.AsyncClient(timeout=httpx.Timeout(80, connect=10)) as client:
        response = await client.get(BASE + "/custos_apontamento",
                                    headers={"Authorization": "Bearer " + token})
        response.raise_for_status()
    rows = from_api(response.json())
    if not rows:
        raise RuntimeError("API /custos_apontamento não retornou apontamentos (envio suspenso)")
    normalized = [grv_row(x) for x in rows]
    if not any(r["recognized"] for r in normalized):
        raise RuntimeError("Campos de horas desconhecidos no GRV (envio suspenso)")
    return normalized


def filter_rows(rows: list[dict], scopes: dict) -> list[dict]:
    fields = {"segmentos": "segment", "maquinas": "machine", "funcionarios": "employee"}
    for option, field in fields.items():
        wanted = {normalize(v) for v in scopes.get(option, [])}
        if wanted:
            rows = [r for r in rows if normalize(r[field]) in wanted]
    return rows


def summarize(grv: list[dict], available: dict[str, float], scopes: dict) -> dict:
    # Rateio usando horas totais apontadas no GRV, como o painel mensal.
    selected = filter_rows(grv, scopes)
    by_employee: dict[str, float] = defaultdict(float)
    subtotal: dict[str, float] = defaultdict(float)
    for r in grv:
        by_employee[r["person"]] += r["total"]
    for r in selected:
        subtotal[r["person"]] += r["total"]
    restrict = any(scopes.get(f) for f in ("segmentos", "maquinas", "funcionarios"))
    capacity = 0.0
    for person, total in available.items():
        if person not in subtotal:
            continue
        capacity += total * (subtotal[person] / by_employee[person] if restrict and by_employee[person] else 1.0)
    prod = sum(r["prod"] for r in selected)
    stop = sum(r["stop"] for r in selected)
    return {"available": capacity, "prod": prod, "stop": stop,
            "waste": capacity - prod - stop, "rows": len(selected),
            "p_prod": prod / capacity if capacity else None,
            "p_stop": stop / capacity if capacity else None,
            "p_waste": (capacity - prod - stop) / capacity if capacity else None}


def fmt(value: float) -> str:
    return f"{value:,.2f}".replace(",", "\x01").replace(".", ",").replace("\x01", ".")


def percent(value: float | None) -> str:
    return "—" if value is None else (f"{value * 100:.1f}%".replace(".", ","))


def bar(value: float | None) -> str:
    amount = max(0, min(10, round(value * 10))) if value is not None else 0
    return "█" * amount + "░" * (10 - amount)


def grade(value: float | None, kind: str) -> str:
    if value is None:
        return "Sem base"
    if kind == "prod":
        return "Ótimo" if value >= 1 else "Bom" if value >= .8 else "Regular" if value >= .75 else "Ruim"
    if kind == "stop":
        return "Ótimo" if value <= .1 else "Bom" if value <= .2 else "Regular" if value <= .4 else "Ruim"
    return "Ótimo" if value <= .02 else "Bom" if value <= .05 else "Regular" if value <= .3 else "Ruim"


def date_label(start: date, end: date) -> str:
    if start == end:
        return start.strftime("%d/%m/%Y")
    if start.day == 1 and end == (date(start.year + (start.month == 12), start.month % 12 + 1, 1) - timedelta(days=1)):
        return f"{MONTHS[start.month - 1].capitalize()}/{start.year}"
    return f"{start:%d/%m/%Y} a {end:%d/%m/%Y}"


def group_lines(kind: str, grv: list[dict], available: dict[str, float], scopes: dict) -> list[str]:
    fields = {"segmentos": ("segment", "POR SEGMENTO"),
              "maquinas": ("machine", "POR MÁQUINA"),
              "funcionarios": ("employee", "POR FUNCIONÁRIO")}
    lines = []
    for selector, (field, title) in fields.items():
        wanted = scopes.get(selector, [])
        if not wanted:
            continue
        lines.extend(("", f"*{title}*"))
        for selected in wanted[:12]:
            specific = {**scopes, selector: [selected]}
            part = summarize(grv, available, specific)
            if not part["rows"]:
                continue
            value = percent(part["p_prod"])
            detail = f"{fmt(part['prod'])} h" if kind == "resumo" else f"{grade(part['p_prod'], 'prod')}"
            lines.append(f"• {selected}: {value} prod. | {detail}")
        if len(wanted) > 12:
            lines.append(f"+ {len(wanted) - 12} itens não detalhados")
    return lines


def message_for(kind: str, frequency: str, start: date, end: date,
                result: dict, rows: list[dict], available: dict, scopes: dict) -> str:
    title = "METAS E INDICADORES" if kind == "metas" else "RESUMO DE HORAS"
    lines = ["*COLUMBIA MACHINE | FECHAMENTO DE HORAS*", title,
             f"*Período:* {date_label(start, end)}",
             "*Periodicidade:* " + {"diario": "Diário", "semanal": "Semanal", "mensal": "Mensal"}[frequency], ""]
    for field, label in (("segmentos", "Segmentos"), ("maquinas", "Máquinas"), ("funcionarios", "Funcionários")):
        choice = scopes.get(field, [])
        if choice:
            lines.append(f"*{label}:* " + (", ".join(choice[:4]) + (f" (+{len(choice)-4})" if len(choice) > 4 else "")))
    if kind == "metas":
        for label, key, code in (("Produtividade", "p_prod", "prod"),
                                  ("Paradas", "p_stop", "stop"),
                                  ("Desperdício", "p_waste", "waste")):
            lines.extend((f"*{label}*", f"{bar(result[key])} {percent(result[key])}",
                          f"*Classificação:* {grade(result[key], code)}", ""))
    else:
        for label, key in (("Disponíveis", "available"), ("Produtivas", "prod"),
                           ("Paradas", "stop"), ("Desperdício", "waste")):
            lines.append(f"{label}: *{fmt(result[key])} h*")
    lines.extend(group_lines(kind, rows, available, scopes))
    lines.append("")
    lines.append("_Relatório automático Columbia · AUVRIUN_")
    text = "\n".join(lines)
    if len(text) > MAX_MESSAGE:
        raise ValueError(f"Mensagem com {len(text)} caracteres excede limite; reduza seleções")
    return text


def job_window(frequency: str, now: datetime) -> tuple[date, date] | None:
    today = now.date()
    if frequency == "diario":
        return (today, today) if today.weekday() < 5 else None
    if frequency == "semanal":
        if today.weekday() != 0:
            return None
        end = today - timedelta(days=1)
        return end - timedelta(days=6), end
    if frequency == "mensal":
        if today.day != 1:
            return None
        end = today - timedelta(days=1)
        return end.replace(day=1), end
    return None


def month_cache_for(period: date) -> str:
    return f"{period.year:04d}-{period.month:02d}"


def validate_payload(sub: dict) -> tuple[str, dict, dict]:
    user = str(sub.get("user") or "").strip()
    preferences = sub.get("preferences") or {}
    types = preferences.get("types") or []
    if not user or preferences.get("frequency") not in ("diario", "semanal", "mensal"):
        raise ValueError("Assinatura inválida")
    if not types or any(t not in ("metas", "resumo") for t in types):
        raise ValueError("Tipo de relatório inválido")
    scopes = preferences.get("scopes") or {}
    if any(not isinstance(scopes.get(field, []), list)
           for field in ("segmentos", "maquinas", "funcionarios")):
        raise ValueError("Filtros de assinatura inválidos")
    return user, preferences, scopes


async def run(preview: bool, force_mode: str | None, at: date | None) -> int:
    app_key = os.environ.get("AUVRIUN_COLUMBIA_KEY", "").strip()
    if not app_key or not app_key.startswith("auv_"):
        raise RuntimeError("Defina AUVRIUN_COLUMBIA_KEY no Windows (chave da aplicação columbia)")
    today = datetime.now(TZ)
    if at:
        today = datetime.combine(at, today.timetz())
    modes = [force_mode] if force_mode else ["diario", "semanal", "mensal"]
    jobs = {mode: win for mode in modes if (win := job_window(mode, today))}
    if not jobs:
        LOG.info("Nenhuma periodicidade programada para %s", today.date())
        return 0
    headers = {"Authorization": "Bearer " + app_key, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10)) as client:
        response = await client.get(WHATSAPP_BASE + "/v1/subscriptions",
                                    params={"app": APP_ID}, headers=headers)
        response.raise_for_status()
        subscriptions = response.json().get("subscriptions") or []
        if not subscriptions:
            LOG.info("Sem assinaturas ativas: nenhum envio")
            return 0
        pending = []
        for sub in subscriptions:
            try:
                user, pref, scopes = validate_payload(sub)
                if pref["frequency"] in jobs:
                    pending.append((user, pref, scopes, jobs[pref["frequency"]]))
            except (TypeError, ValueError) as exc:
                LOG.warning("Assinatura inválida ignorada: %s", exc)
        if not pending:
            LOG.info("Nenhuma assinatura da periodicidade prevista hoje")
            return 0
        grv_all = await get_grv()
        periods = sorted({(window[0], window[1]) for _, _, _, window in pending})
        available_by_range = {}
        grv_by_range = {}
        for start, end in periods:
            relevant = [r for r in grv_all if r["day"] and start <= r["day"] <= end]
            if not relevant:
                raise RuntimeError(f"Sem apontamentos GRV em {start} - {end}; envio suspenso")
            if (end - start).days < 28 and any(not r["actual_date"] for r in relevant):
                raise RuntimeError("GRV não fornece data diária confiável; diário/semanal suspenso")
            if not any(r["recognized"] and r["total"] > 0 for r in relevant):
                raise RuntimeError(f"Sem horas válidas no GRV para {start} - {end}")
            events = await get_events(start, end)
            available = event_availability(events, start, end)
            if not available:
                raise RuntimeError(f"Sem disponibilidade Aponta Fácil em {start} - {end}; envio suspenso")
            grv_by_range[(start, end)] = relevant
            available_by_range[(start, end)] = available
        accepted = 0
        failures = 0
        for user, pref, scopes, (start, end) in pending:
            rows = grv_by_range[(start, end)]
            available = available_by_range[(start, end)]
            result = summarize(rows, available, scopes)
            if not result["rows"] or result["available"] <= 0:
                LOG.warning("Sem dados conciliados para assinatura de %s: não enviado", user)
                failures += 1
                continue
            for kind in pref["types"]:
                try:
                    message = message_for(kind, pref["frequency"], start, end,
                                          result, rows, available, scopes)
                    reference = f"{pref['frequency']}:{start.isoformat()}:{end.isoformat()}"
                    body = {"app": APP_ID, "user": user, "event": EVENT_ID,
                            "type": kind, "reference": reference, "message": message}
                    if preview:
                        LOG.info("PREVIEW %s / %s / %s - %s (%.2f h disp., %.2f h prod.)",
                                 user, kind, reference, len(message), result["available"], result["prod"])
                        continue
                    sent = await client.post(WHATSAPP_BASE + "/v1/subscription/send",
                                             headers={**headers, "Content-Type": "application/json"},
                                             json=body)
                    obj = sent.json()
                    if sent.is_success and (obj.get("ok") or obj.get("duplicate")):
                        accepted += 1
                        LOG.info("Enviado %s/%s -> %s (%s)", user, kind, reference,
                                 "duplicado ignorado" if obj.get("duplicate") else "aceito")
                    else:
                        failures += 1
                        LOG.error("Falha %s/%s: HTTP %s - %s", user, kind,
                                  sent.status_code, str(obj.get("error"))[:120])
                except Exception as exc:
                    failures += 1
                    LOG.exception("Falha na mensagem %s/%s: %s", user, kind, exc)
        LOG.info("Resumo: %s aceitos/duplicados, %s falhas, %s assinantes",
                 accepted, failures, len(pending))
        return 1 if failures else 0


def main():
    parser = argparse.ArgumentParser(description="Disparador automático Columbia -> WhatsApp AUVRIUN")
    parser.add_argument("--preview", action="store_true",
                        help="Calcula indicadores, NÃO envia mensagens")
    parser.add_argument("--mode", choices=("diario", "semanal", "mensal"),
                        help="Executa uma periodicidade específica, se hoje for o dia programado")
    parser.add_argument("--date", type=date.fromisoformat,
                        help="Simula data YYYY-MM-DD; use somente com --preview")
    args = parser.parse_args()
    if args.date and not args.preview:
        parser.error("--date exige --preview para evitar envios fora do calendário")
    logging.basicConfig(level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)])
    try:
        return asyncio.run(run(args.preview, args.mode, args.date))
    except Exception as exc:
        LOG.exception("Execução interrompida: %s", exc)
        return 2


if __name__ == "__main__":
    sys.exit(main())
