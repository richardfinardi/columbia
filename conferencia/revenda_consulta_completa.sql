-- COLUMBIA / CONFERÊNCIA DE REVENDA
-- NCM da última NF de entrada e fornecedor da MESMA nota.
-- Exclusivamente consulta: esta query não modifica nenhum cadastro.
SELECT
    p.codigo,
    p.codigo_interno,
    p.nome,
    p.unidade,
    p.unidade_compra,
    p.cod_classificacao_fiscal,
    p.classificacao_fiscal AS ncm,
    p.descricao_classi_fiscal AS descricao_ncm,
    p.ipi AS "IPI do NCM (%)",
    p.cean_i03 AS "GTIN",
    p.cbenef_i05f AS "Cód. de Beneficio Fiscal na UF",
    p.cclass_trib_ibscbs AS "Cód. Da Classificação Tributária CBS/IBS",
    p.desc_cclass_trib_ibscbs AS "Descrição Da Classificação Tributária CBS/IBS",
    p.u_revisado,
    p.grupo,
    p.subgrupo1,
    p.subgrupo2,
    ultima_nf.ncm_ultima_entrada,
    ultima_nf.numero_nf AS ultima_nf_entrada,
    ultima_nf.dt_emissao AS dt_emissao_ultima_nf,
    ultima_nf.dt_recebimento AS dt_recebimento_ultima_nf,
    ultima_nf.fornecedor_ultima_entrada
FROM tproduto AS p
LEFT JOIN LATERAL (
    SELECT
        ca.ncm_numero AS ncm_ultima_entrada,
        co.n_nf AS numero_nf,
        co.dt_nf AS dt_emissao,
        co.dt_recebimento,
        forn.nome AS fornecedor_ultima_entrada
    FROM tcom_aux AS ca
    INNER JOIN tcompras AS co
        ON co.cod_empresa = ca.cod_empresa
       AND co.codigo = ca.realciona_auto
    LEFT JOIN tfornece AS forn
        ON forn.cod_empresa = co.cod_empresa
       AND forn.codigo = co.cod_fornecedor
    WHERE ca.cod_empresa = p.cod_empresa
      AND ca.cod_produto = p.codigo
      AND co.n_nf IS NOT NULL
    ORDER BY
        co.dt_recebimento DESC NULLS LAST,
        co.dt_nf DESC NULLS LAST,
        co.codigo DESC
    LIMIT 1
) AS ultima_nf ON TRUE
WHERE p.inativo = 0
  AND p.cod_empresa = 1
  AND p.cod_familia = 20
  AND p.metodo_reposicao = 0
ORDER BY p.codigo_interno;
