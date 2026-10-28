# Falha ao carregar o acesso DEV

Ao abrir ou recarregar a página, uma resposta HTTP 502 com `UPSTREAM_TIMEOUT` na operação `state` significa que a consulta ao Google não terminou no prazo. Uma leitura não comprova envio ou salvamento de dados. A interface deve informar que não conseguiu carregar o acesso e oferecer “Tentar carregar novamente”. A referência técnica permanece recolhida em informações para suporte.

## Cenários de teste

- Abrir a página com a consulta `state` indisponível: mostrar erro de carregamento, sem afirmar que dados podem ter sido salvos; não criar sessão nem enviar POST.
- Recuperar a consulta e clicar uma vez em “Tentar carregar novamente”: mostrar somente a etapa confirmada pelo servidor e ocultar a opção de nova consulta.
- Perder a resposta após confirmar o código ou salvar o PIN: manter o tratamento de resultado incerto e “Conferir etapa salva”; nunca repetir automaticamente a alteração.
- Manter a duração e o código técnico disponíveis somente na seção recolhida de suporte.

Esta correção de mensagem não reduz a latência do Google e não altera limites de tempo, autenticação ou persistência. Medir novamente a latência real após o deploy; o teste local usa falha de transporte simulada.
