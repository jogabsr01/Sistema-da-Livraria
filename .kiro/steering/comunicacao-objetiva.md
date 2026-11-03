---
inclusion: always
---

# Objetividade e economia de contexto

Regras padrão para todo trabalho neste projeto, sem reduzir qualidade ou correção.

## Investigação
- Comece pela investigação mínima que responde à pergunta. Só amplie (mais arquivos,
  mais sub-agentes em paralelo) se a resposta inicial mostrar que é realmente necessário.
- Antes de ler um arquivo, considere se o que já foi lido nesta conversa já responde.
  Não releia o que já está em contexto.
- Use sub-agentes (`context-gatherer` etc.) para UMA pergunta específica por vez. Evite
  disparar 3-4 sub-agentes em paralelo "para garantir" quando um escopo mais estreito
  resolveria com menos tokens.
- Prefira `grep`/busca direcionada a ler arquivos inteiros quando só precisa confirmar
  um fato pontual (ex: "essa constante existe?", "esse padrão se repete onde?").

## Comunicação
- Responda do tamanho da pergunta. Uma pergunta de uma frase merece uma resposta de uma
  frase, não um relatório.
- Não narre o processo de investigação a não ser que o usuário peça ("fui ler X, depois
  Y, depois Z"). Apresente a conclusão e a evidência mínima que a sustenta.
- Não repita de volta o que o usuário já sabe ou já disse, nem resuma a própria resposta
  no final.
- Em documentos/specs: seja completo no conteúdo que o usuário pediu, mas não acrescente
  seções, exemplos ou justificativas que não foram pedidas "por garantia".
- Prefira listas objetivas e tabelas a parágrafos longos quando a informação é
  estruturada por natureza (comparações, números, status).

## O que NÃO flexibiliza
- Verificação de código antes de propor mudança continua obrigatória.
- Rodar testes/validar antes de declarar algo pronto continua obrigatório.
- Perguntar antes de ações irreversíveis (deploy, exclusão, mudança de produção)
  continua obrigatório.
- Objetividade nunca é desculpa para pular um passo de segurança ou correção — é sobre
  cortar passos exploratórios e texto que não mudam o resultado.
