# SimuSystem para Android

Aplicativo Android que abre o SimuSystem publicado em
https://jesuinonetomv-bot.github.io/SimuSystem/.
O APK 38.0 corresponde à versão web v38 no momento da criação. As futuras
atualizações do site aparecem automaticamente no aplicativo.

Compatível com Android 7.0 ou mais recente (API 24), com Android System
WebView atualizado. Precisa de internet para abrir o simulador, fazer login
e sincronizar os diagramas, sessões e histórico. O cache da versão web pode
reter recursos já acessados; isso não garante operação offline.

O aplicativo preserva JavaScript, armazenamento local, confirmação de
comandos, login de operador e administrador, rotação e tela cheia. A sessão
do aplicativo é independente da sessão do navegador. O botão Voltar retorna
na navegação e, na tela inicial, mantém o simulador em segundo plano.
Links externos abrem no navegador. Apenas o domínio e caminho publicados
do SimuSystem podem navegar dentro do WebView. Não há ponte JavaScript com
métodos nativos, permissões de armazenamento ou tráfego HTTP sem TLS.

## Compilar

Requisitos: Python 3, JDK 17 e Android SDK com `platforms;android-36` e
`build-tools;36.0.0`. Não utiliza Gradle ou bibliotecas externas.

```sh
export ANDROID_SDK_ROOT=/caminho/do/android-sdk
python3 android/build.py --output /caminho/SimuSystem-v38-unsigned.apk
```

O comando executa os testes de navegação, compila os recursos e Java,
gera DEX e alinha o APK. Para gerar um APK instalável de atualização,
reutilize a chave de assinatura original e defina antes da compilação:

- `SIMUSYSTEM_KEYSTORE`: caminho do keystore privado.
- `SIMUSYSTEM_KEY_ALIAS`: alias, por padrão `simusystem`.
- `SIMUSYSTEM_STORE_PASSWORD` e `SIMUSYSTEM_KEY_PASSWORD`: senhas privadas.

Com essas variáveis o script assina e verifica o APK. Nunca publique a chave
ou suas senhas no repositório. Incremente `versionCode` e `versionName` no
manifesto a cada nova distribuição Android. Mantenha o package name
`com.jesuino.simusystem` e a mesma assinatura para atualizar sem desinstalar.

O simulador destina-se exclusivamente a treinamento.
