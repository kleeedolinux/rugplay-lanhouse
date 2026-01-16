import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { isoImport } from 'vite-plugin-iso-import';

export default defineConfig({
	plugins: [sveltekit(), isoImport()],
	server: {
		port: 80,
		host: true,
		allowedHosts: ['rugplay-lanhouse.squareweb.app']
	},
	preview: {
		port: 80,
		host: true,
		allowedHosts: ['rugplay-lanhouse.squareweb.app']
	},
	build: {
		minify: 'esbuild',
		sourcemap: false,
		rollupOptions: {
			external: ['zod']
		}
	},
	ssr: {
		noExternal: [],
		external: ['zod', 'openai']
	}
});
