import {
	CompletionItem,
	CompletionItemKind,
	CompletionList,
	ServiceContext,
} from '@volar/language-server';
import { AstroFile } from '../../core/index.js';
import { editShouldBeInFrontmatter, ensureProperEditForFrontmatter } from '../utils.js';

export function enhancedProvideCompletionItems(completions: CompletionList): CompletionList {
	completions.items = completions.items.filter(isValidCompletion).map((completion) => {
		const source = completion?.data?.originalItem?.source;
		if (source) {
			// Sort completions starting with `astro:` higher than other imports
			if (source.startsWith('astro:')) {
				completion.sortText = '\u0000' + (completion.sortText ?? completion.label);
			}

			// For components import, use the file kind and sort them first, as they're often what the user want over something else
			if (['.astro', '.svelte', '.vue'].some((ext) => source.endsWith(ext))) {
				completion.kind = CompletionItemKind.File;
				completion.detail = completion.detail + '\n\n' + source;
				completion.sortText = '\u0001' + (completion.sortText ?? completion.label);
				completion.data.isComponent = true;
			}
		}

		return completion;
	});

	return completions;
}

export function enhancedResolveCompletionItem(
	resolvedCompletion: CompletionItem,
	context: ServiceContext
): CompletionItem {
	// Make sure we keep our icons even when the completion is resolved
	if (resolvedCompletion.data.isComponent) {
		resolvedCompletion.detail = getDetailForFileCompletion(
			resolvedCompletion.detail ?? '',
			resolvedCompletion.data.originalItem.source
		);
	}

	if (resolvedCompletion.additionalTextEdits) {
		const [virtualFile, source] = context.documents.getVirtualFileByUri(
			resolvedCompletion.data.uri
		);
		const file = source?.root;
		if (!virtualFile || !(file instanceof AstroFile) || !context.host) return resolvedCompletion;

		resolvedCompletion.additionalTextEdits = resolvedCompletion.additionalTextEdits.map((edit) => {
			if (editShouldBeInFrontmatter(edit.range, file.astroMeta).itShould) {
				edit = ensureProperEditForFrontmatter(edit, file.astroMeta, '\n');
			}

			return edit;
		});
	}

	return resolvedCompletion;
}

function getDetailForFileCompletion(detail: string, source: string): string {
	return `${detail}\n\n${source}`;
}

// When Svelte components are imported, we have to reference the svelte2tsx's types to properly type the component
// An unfortunate downside of this is that it pollutes completions, so let's filter those internal types manually
const svelte2tsxTypes = new Set([
	'Svelte2TsxComponent',
	'Svelte2TsxComponentConstructorParameters',
	'SvelteComponentConstructor',
	'SvelteActionReturnType',
	'SvelteTransitionConfig',
	'SvelteTransitionReturnType',
	'SvelteAnimationReturnType',
	'SvelteWithOptionalProps',
	'SvelteAllProps',
	'SveltePropsAnyFallback',
	'SvelteSlotsAnyFallback',
	'SvelteRestProps',
	'SvelteSlots',
	'SvelteStore',
]);

function isValidCompletion(completion: CompletionItem) {
	const isSvelte2tsxCompletion =
		completion.label.startsWith('__sveltets_') || svelte2tsxTypes.has(completion.label);

	// Filter out completions for the children prop, as it doesn't work in Astro
	const isChildrenCompletion =
		completion.label === 'children?' &&
		completion.kind === CompletionItemKind.Field &&
		completion.filterText === 'children={$1}';

	if (isSvelte2tsxCompletion || isChildrenCompletion) return false;

	return true;
}
