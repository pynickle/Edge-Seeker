import { build } from 'esbuild'
import yamlPlugin from 'esbuild-plugin-yaml'

await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'lib/index.cjs',
    format: 'cjs',
    platform: 'node',
    external: [
        'koishi',
        'axios',
        'dayjs',
        'koishi-plugin-cron',
        'lunar-typescript',
        'node-emoji',
        'whoiser',
        'koishi-plugin-puppeteer',
        'koishi-plugin-adapter-onebot',
        '@koishijs/plugin-server',
    ],
    plugins: [yamlPlugin.yamlPlugin({})],
})
