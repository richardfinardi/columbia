# Ativar links públicos do Planejamento PCP Columbia

O portal de consulta já está no GitHub da Columbia, em \`pcp/portal.html\`. Mas **criar links, verificar validade e desativá-los exige configurar este router no processo FastAPI do servidor Columbia**. Apenas publicar os arquivos do GitHub não instala a API.

## 1. Instalar o router no mesmo servidor FastAPI da Columbia

Copie \`portal_routes.py\` para uma pasta importável pelo Python que hospeda \`https://columbia.consultoriarf.net\`, mantendo o código junto da aplicação FastAPI. O módulo usa \`fastapi\`, \`pydantic\` e bibliotecas padrão do Python (SQLite, secrets, base64).

A integração precisa reutilizar três funções **já existentes** na aplicação Python, ou criar wrappers para elas:

- \`pcp_user_dependency\`: recebe o Bearer e verifica de verdade a sessão no servidor. Deve retornar \`{"usuario": "NOME", "u_pcp": 1}\` exclusivamente para quem tem permissão PCP. Para usuários comuns, devolva as permissões reais, não force 1.
- \`rows_provider\`: função que retorna a **mesma lista completa de OS** utilizada pelo endpoint \`GET /producao\`, em formato Python \`list[dict]\`. Ela deve consultar a fonte interna em vez de fazer HTTP para o próprio servidor.
- \`pdf_provider\`: função que aceita três parâmetros \`(cod_empresa, cod_os, cod_os_aux)\` e devolve bytes de PDF, \`{"pdf_base64":"..."}\` ou uma string base64. Pode reutilizar a rotina interna do endpoint \`/producao/desenho-anexo\`.

**Exemplo estrutural** (adapte os nomes das funções à aplicação real):

\`\`\`python
from fastapi import Depends, FastAPI
from pcp.backend.portal_routes import build_pcp_router

app = FastAPI()  # ou use o objeto app que JÁ existe na Columbia

# Exemplos de ADAPTADORES: estas funções não são fornecidas pelo router.
def verificar_usuario_columbia(token=Depends(validar_token_que_ja_existe)):
    return {
        "usuario": token["usuario"],
        "u_pcp": token.get("u_pcp", 0),
    }

def os_da_producao():
    return consultar_producao_diretamente_no_banco_ou_na_funcao_existente()

def carregar_pdf_columbia(cod_empresa, cod_os, cod_os_aux):
    return buscar_pdf_pela_mesma_rotina_do_endpoint_de_desenho()

app.include_router(build_pcp_router(
    pcp_user_dependency=verificar_usuario_columbia,
    rows_provider=os_da_producao,
    pdf_provider=carregar_pdf_columbia,
    db_path=r"C:\api-dados\columbia_pcp_portals.sqlite3",
))
\`\`\`

Não copie o \`app=FastAPI()\` para dentro de um servidor que já tem \`app\`: importe \`build_pcp_router\` e chame \`app.include_router(...)\` **uma vez**, usando a instância existente.

## 2. Endpoints

| Método | Rota | Acesso |
|---|---|---|
| POST | \`/producao/pcp/portal\` | Usuário autenticado com \`u_pcp=1\` |
| GET | \`/producao/pcp/portais\` | Usuário autenticado com \`u_pcp=1\` |
| PATCH | \`/producao/pcp/portal/{id}/status\` | Usuário autenticado com \`u_pcp=1\` |
| GET | \`/producao/pcp/portal/{id}/dados?token=...\` | Público, porém requer token válido, não vencido e não desativado |
| GET | \`/producao/pcp/portal/{id}/anexo?token=...&os=...&aux=...\` | Público com token válido; PDF daquela OS autorizada |

**Exemplo do POST**:

\`\`\`json
{
  "nome": "Planejamento outubro",
  "validade_dias": 30,
  "mostrar_valores": true,
  "permitir_excel": false,
  "os": ["6150", "6151", "6152"]
}
\`\`\`

A resposta contém \`portal.id\`, \`portal.token\` e \`portal.url\`. O token nunca é derivado dos números de OS, usuário ou data.

O GET público oferece somente: OS, orçamento, item, cliente, segmento, datas, processos pendentes, valores (se liberados) e lista de anexos. Ele não entrega funcionalidades de gravação nem campos internos de controle.

## 3. Persistência, validade e domínio

Os links são armazenados em SQLite. **Não salve o banco dentro do repositório público GitHub**. Use uma pasta persistente no servidor, com acesso restrito ao processo da API, faça backup e preserve-a durante atualizações/reinicializações.

Variáveis opcionais:
- \`COLUMBIA_PCP_PORTAL_DB\`: caminho absoluto do arquivo SQLite persistente.
- \`COLUMBIA_PCP_PORTAL_URL\`: URL final da página pública \`portal.html\`; o valor padrão é \`https://consultoriarf.net/columbia/pcp/portal.html\`.

O token está armazenado no SQLite para permitir que usuários autorizados copiem novamente links já gerados. Trate esse banco como segredo operacional: proteção por permissões do Windows, backups com acesso controlado e nunca servir o arquivo diretamente via web.

A validade é conferida **no backend** toda vez que alguém abre ou atualiza o planejamento e toda vez que um anexo é solicitado. Desativação é imediata para novas solicitações. Um PDF já baixado ou uma página já aberta não pode ser apagado retroativamente; não há como revogar cópias que o destinatário já salvou.

## 4. CORS e segurança

O servidor precisa autorizar via CORS a origem da página \`https://consultoriarf.net\` (ou o domínio realmente usado) nos endpoints necessários, mantendo métodos de escrita restritos a usuários autorizados.

Atenção: um token público de compartilhamento é um **segredo de acesso**; quem possuir a URL poderá ler o planejamento até ele vencer ou ser desativado. Os links são gerados com \`secrets.token_urlsafe(32)\`. Compartilhe somente com destinatários autorizados pelo negócio, evite exposição em logs de requisições, proteja os arquivos e configure HTTPS.

É recomendável também limitar taxa de requisições, monitorar acessos e configurar \`Referrer-Policy: no-referrer\` (a página já declara a política). O roteador retorna anexos com \`Cache-Control: private, no-store\`, \`Content-Disposition: inline\` e checagem de OS/autorização.

## 5. Teste após instalar no servidor

1. Entrar com usuário PCP, gerar um link de 7 dias e verificar que aparece em **Gerenciar links**.
2. Abrir o link em aba anônima **sem login**; conferir colunas, semanas, contagens e valores.
3. Confirmar que o portal público não mostra **Salvar**, **Renegociar** ou qualquer botão de edição.
4. Abrir um anexo PDF e confirmar que vai **diretamente para uma nova aba**.
5. Desativar o link no painel PCP e confirmar que consultas e PDFs passam a devolver indisponível/HTTP 410.
6. Testar um usuário sem PCP nos endpoints de criação/administração: resposta HTTP 403.
7. Gerar link **sem valores** e comprovar que os valores não aparecem nem na resposta do endpoint público.
8. Verificar se as alterações de previsão/renegociação refletem na semana correspondente ao recarregar a página, sem mudar a seleção de OS originalmente compartilhada.

## Situação

As páginas e o backend-fonte estão prontos no GitHub, mas **não há confirmação de instalação deste módulo na API da Columbia**. O GitHub sozinho não habilita a funcionalidade de validade sem login. É necessário integrar e implantar este código no servidor Windows/Cloudflared usado pela Columbia, usando as funções reais de autenticação, consulta de OS e busca de PDF.
