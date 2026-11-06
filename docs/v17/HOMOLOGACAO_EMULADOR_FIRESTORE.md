# Pré-requisito para homologação Firestore

A homologação ponta a ponta requer o **Emulator Suite oficial**, separado do stub em memória usado pelos testes unitários. Instale `firebase-tools` e disponibilize um Java compatível com o emulador. Com uma configuração Firebase local que habilite o emulador Firestore em `127.0.0.1:8080` e um projeto descartável `demo-*`, mantenha em execução:

```sh
firebase emulators:start --only firestore --project demo-livraria-test
```

Em outro terminal, na raiz do projeto, execute:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
```

Este repositório não fornece atualmente um `firebase.json`; é necessário preparar uma configuração local apropriada antes de iniciar o comando. Se outra porta for configurada, ajuste `FIRESTORE_EMULATOR_HOST` de acordo. O helper de teste cria projetos isolados; para os testes da migração, usa projetos `demo-*` e exige `127.0.0.1`.

O executor exige também flag explícita, preflight, projeto `demo-*` confirmado e backup com hash verificado. A sondagem TCP não comprova que o processo na porta é o emulador oficial. Os testes em memória não substituem testes de concorrência, transações, retomada e falhas de comunicação no emulador oficial. O teste de leitura do reconciliador é ignorado quando a variável não está configurada; ainda falta implementar e executar o teste ponta a ponta do executor. O reconciliador não roda automaticamente após a importação. A homologação e o cutover real permanecem pendentes; não utilizar dados reais.