# KARV Sentinel

Agente baseado no OpenAI Agents SDK para classificar incidentes, reconhecer erros, avaliar melhorias e preparar correções seguras.

## Limite operacional

O Sentinel pode recomendar e preparar uma correção em branch `agent/*` e PR draft. Ele nunca pode executar merge, deploy, mudanças diretas em `main`, alterações de segredos, cobrança ou redução de controles de segurança.

## Entrada

Um incidente JSON validado contendo fonte, projeto, data, resumo e evidências observadas. Conteúdo livre é tratado como dado não confiável.

Os traces do SDK permanecem ativos para auditoria do fluxo, mas com `traceIncludeSensitiveData=false` para não armazenar o conteúdo do incidente.

## Execução local

```bash
npm ci
OPENAI_API_KEY=<configurada-no-ambiente> npm run analyze -- incidente.json decisao.json
npm run check
```

Não coloque a chave no comando, histórico ou arquivos versionados. Use um ambiente seguro e ignorado.

## Evals

Os casos em `evals/cases.jsonl` exercitam correção P2 reproduzível, incidente de segurança e evidência insuficiente. A execução ao vivo exige uma chave configurada no ambiente e grava o resultado somente em `evals/results/latest.json`, que é ignorado pelo Git.
