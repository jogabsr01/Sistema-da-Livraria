# Consulta opcional de CEP — BrasilAPI

O proprietário autorizou explicitamente o envio opcional de **somente o CEP** à BrasilAPI em 23/10/2026, após a revisão automática exigir autorização específica. Essa autorização resolveu a restrição anterior; não solicitar novamente.

No formulário de cliente do Caixa, o botão **Preencher pelo CEP** informa o destino e consulta apenas ao clique. Não há consulta ao digitar, abrir formulário ou salvar cliente. O preenchimento manual permanece disponível. O operador confere o resultado e informa o número; nome, CPF, telefone, e-mail, número e complemento não são enviados ao provedor.

O navegador chama `POST /api/v1/customers/postal-code` com `{postalCode}`. Requer sessão operacional, origem exata, CSRF e feature de clientes ativada; campos extras são recusados. O backend normaliza oito dígitos e chama exclusivamente `https://brasilapi.com.br/api/cep/v2/<CEP>`, sem encaminhar headers, cookies, credenciais ou corpo do usuário e sem seguir redirecionamentos.

Timeout de 4,5 segundos, resposta limitada a 8.000 bytes, UTF-8 estrito, CEP de retorno correspondente, UF válida e textos com limites. Falha, limite ou resposta inválida não substituem o endereço digitado: a interface libera o preenchimento manual. O retorno serve somente de sugestão; não salva o cliente automaticamente.

Limites persistentes usam o mecanismo existente de guardas, com domínios HMAC separados de login/ISBN: cinco consultas por usuário e trinta na instalação por janela de quinze minutos, bloqueio progressivo iniciado em sessenta segundos. O preenchimento manual continua após o limite. Nenhum CEP é gravado nos contadores. Exige guardas privadas existentes no Apps Script; indisponibilidade desses controles não permite consulta externa sem limite.

Não há nova chave ou escopo Google. A configuração real do Google permanece para a etapa posterior. Testes usam respostas locais fictícias da BrasilAPI; não declaram disponibilidade ou latência real do serviço externo.
