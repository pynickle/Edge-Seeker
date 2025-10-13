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
        '@koishijs/plugin-adapter-onebot',
    ],
    plugins: [yamlPlugin.yamlPlugin({})],
})
