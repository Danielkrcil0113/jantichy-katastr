<script lang="ts">
	import { browser } from '$app/environment';
	import { onDestroy } from 'svelte';
	import type {
		GeoPosition,
		LetterDraftData,
		LetterVariant,
		ParcelCandidate,
		ParcelLookupResponse
	} from '$lib/types';

	type LetterVariantOption = {
		id: LetterVariant;
		title: string;
		description: string;
		badge: string;
		accent: string;
	};

	type StepItem = {
		id: string;
		title: string;
		description: string;
		status: 'hotovo' | 'aktivní' | 'čeká';
	};

	const letterVariants: LetterVariantOption[] = [
		{
			id: 'classic',
			title: 'Varianta 1',
			description: 'Klasický seriózní dopis vhodný pro konzervativní oslovení.',
			badge: 'Klasická',
			accent: 'bg-slate-900'
		},
		{
			id: 'modern',
			title: 'Varianta 2',
			description: 'Moderní obchodní vzhled s výraznějším modrým stylem.',
			badge: 'Moderní',
			accent: 'bg-blue-700'
		},
		{
			id: 'premium',
			title: 'Varianta 3',
			description: 'Prémiovější elegantní styl s jemným rámečkem.',
			badge: 'Prémiová',
			accent: 'bg-amber-600'
		}
	];

	let position = $state<GeoPosition | null>(null);
	let lookup = $state<ParcelLookupResponse | null>(null);
	let selectedParcelId = $state('');

	let isGettingLocation = $state(false);
	let isFindingParcel = $state(false);
	let isGeneratingPdf = $state(false);
	let isGeneratingPreview = $state(false);

	let errorMessage = $state('');
	let copyMessage = $state('');
	let pdfMessage = $state('');
	let previewError = $state('');

	let radiusMeters = $state(25);
	let pdfVariant = $state<LetterVariant>('classic');
	let previewPdfUrl = $state<string | null>(null);

	let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let previewAbortController: AbortController | null = null;
	let activePreviewObjectUrl: string | null = null;
	let lastPreviewKey = '';

	let form = $state<LetterDraftData>({
		recipientName: '',
		recipientAddress: '',
		buyerName: '',
		buyerAddress: '',
		buyerEmail: '',
		buyerPhone: '',
		offerAmount: '',
		customMessage:
			'Rád bych Vám tímto nezávazně nabídl možnost odkupu uvedeného pozemku. V případě zájmu jsem připraven se domluvit na férových podmínkách a uhradit veškeré související administrativní náklady.'
	});

	let selectedParcel = $derived(
		lookup?.parcels.find((parcel) => parcel.id === selectedParcelId) ?? lookup?.parcels[0] ?? null
	);

	let selectedVariantOption = $derived(
		letterVariants.find((variant) => variant.id === pdfVariant) ?? letterVariants[0]
	);

	let parcelSummary = $derived(getParcelText(selectedParcel));
	let letterText = $derived(getLetterText());

	let completionPercent = $derived(
		Math.round(
			(((position ? 1 : 0) +
				(selectedParcel ? 1 : 0) +
				(form.recipientName.trim() ? 1 : 0) +
				(form.buyerName.trim() ? 1 : 0) +
				(form.offerAmount.trim() ? 1 : 0)) /
				5) *
				100
		)
	);

	let stepItems = $derived<StepItem[]>([
		{
			id: 'gps',
			title: 'Poloha',
			description: position ? 'GPS poloha je načtená' : 'Získej aktuální GPS bod',
			status: position ? 'hotovo' : 'aktivní'
		},
		{
			id: 'parcel',
			title: 'Parcela',
			description: selectedParcel ? `Vybrána parcela ${selectedParcel.parcelNumber}` : 'Vyber kandidátní parcelu',
			status: selectedParcel ? 'hotovo' : position ? 'aktivní' : 'čeká'
		},
		{
			id: 'letter',
			title: 'Dopis',
			description: form.recipientName.trim() ? 'Dopis je personalizovaný' : 'Doplň vlastníka a nabídku',
			status: form.recipientName.trim() && form.offerAmount.trim() ? 'hotovo' : selectedParcel ? 'aktivní' : 'čeká'
		},
		{
			id: 'pdf',
			title: 'PDF',
			description: previewPdfUrl ? 'Náhled je připravený' : 'Vyber styl a stáhni PDF',
			status: previewPdfUrl ? 'hotovo' : 'čeká'
		}
	]);

	$effect(() => {
		if (!browser) return;

		const previewKey = JSON.stringify({
			variant: pdfVariant,
			letterText,
			parcelSummary,
			recipientName: form.recipientName,
			buyerName: form.buyerName,
			offerAmount: form.offerAmount,
			fileName: getPdfFileName()
		});

		schedulePdfPreview(previewKey);
	});

	onDestroy(() => {
		if (previewDebounceTimer) {
			clearTimeout(previewDebounceTimer);
		}

		if (previewAbortController) {
			previewAbortController.abort();
		}

		if (activePreviewObjectUrl) {
			URL.revokeObjectURL(activePreviewObjectUrl);
		}
	});

	function formatNumber(value: number, digits = 6): string {
		return new Intl.NumberFormat('cs-CZ', {
			minimumFractionDigits: digits,
			maximumFractionDigits: digits
		}).format(value);
	}

	function formatOptional(value: string | number | null | undefined): string {
		if (value === null || value === undefined || value === '') return '—';
		return String(value);
	}

	function getStatusClasses(status: StepItem['status']): string {
		if (status === 'hotovo') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
		if (status === 'aktivní') return 'border-blue-200 bg-blue-50 text-blue-800';
		return 'border-slate-200 bg-slate-50 text-slate-500';
	}

	function getLocation(): Promise<GeoPosition> {
		return new Promise((resolve, reject) => {
			if (!navigator.geolocation) {
				reject(new Error('Tento prohlížeč nepodporuje geolokaci.'));
				return;
			}

			navigator.geolocation.getCurrentPosition(
				(result) => {
					resolve({
						latitude: result.coords.latitude,
						longitude: result.coords.longitude,
						accuracy: Number.isFinite(result.coords.accuracy) ? result.coords.accuracy : null,
						timestamp: result.timestamp
					});
				},
				(err) => {
					if (err.code === err.PERMISSION_DENIED) {
						reject(new Error('Přístup k poloze byl zamítnut.'));
						return;
					}

					if (err.code === err.POSITION_UNAVAILABLE) {
						reject(new Error('Polohu se nepodařilo zjistit.'));
						return;
					}

					if (err.code === err.TIMEOUT) {
						reject(new Error('Zjištění polohy trvalo příliš dlouho.'));
						return;
					}

					reject(new Error('Nastala neznámá chyba při zjišťování polohy.'));
				},
				{
					enableHighAccuracy: true,
					timeout: 12000,
					maximumAge: 0
				}
			);
		});
	}

	async function handleGetLocation() {
		errorMessage = '';
		copyMessage = '';
		pdfMessage = '';
		previewError = '';
		lookup = null;
		selectedParcelId = '';
		isGettingLocation = true;

		try {
			position = await getLocation();

			if (position.accuracy) {
				radiusMeters = Math.max(5, Math.min(Math.ceil(position.accuracy), 35));
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Nepodařilo se zjistit polohu.';
		} finally {
			isGettingLocation = false;
		}
	}

	async function handleFindParcel() {
		errorMessage = '';
		copyMessage = '';
		pdfMessage = '';
		previewError = '';
		selectedParcelId = '';

		if (!position) {
			errorMessage = 'Nejdřív zjisti GPS polohu.';
			return;
		}

		isFindingParcel = true;

		try {
			const response = await fetch('/api/parcel', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					latitude: position.latitude,
					longitude: position.longitude,
					accuracy: position.accuracy,
					radiusMeters
				})
			});

			const data = await response.json();

			if (!response.ok) {
				throw new Error(data.message || 'Nepodařilo se najít parcelu.');
			}

			lookup = data;
			selectedParcelId = lookup?.parcels[0]?.id ?? '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Nepodařilo se najít parcelu.';
		} finally {
			isFindingParcel = false;
		}
	}

	function today(): string {
		return new Intl.DateTimeFormat('cs-CZ', {
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(new Date());
	}

	function getParcelText(parcel: ParcelCandidate | null): string {
		if (!parcel) return '[DOPLŇTE IDENTIFIKACI POZEMKU]';

		const parts = [
			`pozemku parc. č. ${parcel.parcelNumber}`,
			`katastrální území ${parcel.katastralniUzemiNazev}`
		];

		if (parcel.katastralniUzemiKod) {
			parts.push(`kód KÚ ${parcel.katastralniUzemiKod}`);
		}

		if (parcel.vymera) {
			parts.push(`výměra ${parcel.vymera} m²`);
		}

		if (parcel.druhPozemku) {
			parts.push(`druh pozemku: ${parcel.druhPozemku}`);
		}

		return parts.join(', ');
	}

	function getLetterText(): string {
		const recipientName = form.recipientName.trim() || '[DOPLŇTE JMÉNO VLASTNÍKA]';
		const recipientAddress = form.recipientAddress.trim() || '[DOPLŇTE ADRESU VLASTNÍKA]';
		const buyerName = form.buyerName.trim() || '[DOPLŇTE SVÉ JMÉNO / NÁZEV FIRMY]';
		const buyerAddress = form.buyerAddress.trim() || '[DOPLŇTE SVOU ADRESU]';
		const buyerEmail = form.buyerEmail.trim() || '[DOPLŇTE E-MAIL]';
		const buyerPhone = form.buyerPhone.trim() || '[DOPLŇTE TELEFON]';
		const offerAmount = form.offerAmount.trim() || '[DOPLŇTE NABÍZENOU ČÁSTKU]';
		const message = form.customMessage.trim();

		return `${recipientName}
${recipientAddress}

${buyerName}
${buyerAddress}

Věc: Nezávazná nabídka odkupu pozemku

Vážená paní, vážený pane,

obracím se na Vás jako na vlastníka ${parcelSummary}.

${message}

Za výše uvedený pozemek bych Vám rád nabídl částku ${offerAmount}. Tato nabídka je nezávazná a slouží jako podklad pro případné další jednání.

V případě Vašeho zájmu mě prosím kontaktujte na e-mailu ${buyerEmail} nebo telefonicky na čísle ${buyerPhone}.

Děkuji Vám za zvážení mé nabídky.

S pozdravem

${buyerName}

V ${today()}`;
	}

	function getPdfFileName(): string {
		const parcelPart = selectedParcel?.parcelNumber.replace('/', '-') || 'pozemek';
		return `nabidka-odkupu-${parcelPart}-${pdfVariant}`;
	}

	function getPdfPayload() {
		return {
			variant: pdfVariant,
			letterText,
			parcelSummary,
			recipientName: form.recipientName,
			buyerName: form.buyerName,
			offerAmount: form.offerAmount,
			fileName: getPdfFileName()
		};
	}

	async function readPdfError(response: Response): Promise<string> {
		const text = await response.text();

		try {
			const parsed = JSON.parse(text);
			return parsed.message || 'PDF se nepodařilo vygenerovat.';
		} catch {
			return text || 'PDF se nepodařilo vygenerovat.';
		}
	}

	function schedulePdfPreview(previewKey: string) {
		if (previewKey === lastPreviewKey) return;

		lastPreviewKey = previewKey;
		previewError = '';

		if (previewDebounceTimer) {
			clearTimeout(previewDebounceTimer);
		}

		previewDebounceTimer = setTimeout(() => {
			void generatePdfPreview();
		}, 900);
	}

	async function generatePdfPreview() {
		if (!browser) return;

		if (previewAbortController) {
			previewAbortController.abort();
		}

		previewAbortController = new AbortController();
		isGeneratingPreview = true;
		previewError = '';

		try {
			const response = await fetch('/api/letter/pdf', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(getPdfPayload()),
				signal: previewAbortController.signal
			});

			if (!response.ok) {
				throw new Error(await readPdfError(response));
			}

			const blob = await response.blob();
			const nextUrl = URL.createObjectURL(blob);

			if (activePreviewObjectUrl) {
				URL.revokeObjectURL(activePreviewObjectUrl);
			}

			activePreviewObjectUrl = nextUrl;
			previewPdfUrl = nextUrl;
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				return;
			}

			previewError =
				error instanceof Error ? error.message : 'Náhled PDF se nepodařilo vygenerovat.';
		} finally {
			isGeneratingPreview = false;
		}
	}

	async function copyLetter() {
		copyMessage = '';
		pdfMessage = '';

		try {
			await navigator.clipboard.writeText(letterText);
			copyMessage = 'Dopis zkopírován do schránky.';
		} catch {
			copyMessage = 'Kopírování se nepodařilo. Označ text ručně a zkopíruj ho.';
		}
	}

	async function downloadPdf() {
		errorMessage = '';
		copyMessage = '';
		pdfMessage = '';
		isGeneratingPdf = true;

		try {
			const response = await fetch('/api/letter/pdf', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(getPdfPayload())
			});

			if (!response.ok) {
				throw new Error(await readPdfError(response));
			}

			const blob = await response.blob();
			const url = URL.createObjectURL(blob);

			const link = document.createElement('a');
			link.href = url;
			link.download = `${getPdfFileName()}.pdf`;
			document.body.appendChild(link);
			link.click();
			link.remove();

			URL.revokeObjectURL(url);

			pdfMessage = 'PDF bylo vygenerováno a staženo.';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'PDF se nepodařilo vygenerovat.';
		} finally {
			isGeneratingPdf = false;
		}
	}
</script>

<svelte:head>
	<title>Nabídka odkupu pozemku</title>
	<meta
		name="description"
		content="Aplikace pro nalezení kandidátních parcel podle GPS přes API KN a vytvoření návrhu dopisu s nabídkou odkupu."
	/>
</svelte:head>

<main class="min-h-screen bg-slate-950">
	<div class="relative isolate overflow-hidden">
		<div class="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.28),transparent_34rem),radial-gradient(circle_at_top_right,rgba(245,158,11,0.18),transparent_28rem),linear-gradient(180deg,#020617_0%,#0f172a_45%,#f8fafc_45%,#eef2ff_100%)]"></div>

		<section class="px-4 pb-6 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
			<div class="mx-auto max-w-7xl">
				<div class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
					<div>
						<div class="mb-5 flex flex-wrap items-center gap-2">
							<span class="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
								REST API KN
							</span>
							<span class="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
								Živý PDF náhled
							</span>
							<span class="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white backdrop-blur">
								SvelteKit
							</span>
						</div>

						<h1 class="max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
							Nabídka odkupu pozemku podle GPS
						</h1>

						<p class="mt-5 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
							Získej polohu, najdi kandidátní parcelu, připrav dopis a sleduj PDF náhled v reálném
							čase. Vlastníka zatím doplňuješ ručně, aby workflow zůstalo právně bezpečné.
						</p>
					</div>

					<div class="rounded-3xl border border-white/10 bg-white/10 p-5 text-white shadow-2xl backdrop-blur">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="text-sm text-slate-300">Dokončení workflow</p>
								<p class="mt-1 text-3xl font-black">{completionPercent} %</p>
							</div>
							<div class="grid h-16 w-16 place-items-center rounded-2xl bg-white text-lg font-black text-slate-950">
								{completionPercent}
							</div>
						</div>

						<div class="mt-5 h-3 overflow-hidden rounded-full bg-white/15">
							<div
								class="h-full rounded-full bg-gradient-to-r from-blue-400 via-cyan-300 to-emerald-300 transition-all duration-500"
								style={`width: ${completionPercent}%`}
							></div>
						</div>

						<div class="mt-5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-2">
							{#each stepItems as step (step.id)}
								<div class={`rounded-2xl border px-3 py-3 ${getStatusClasses(step.status)}`}>
									<p class="font-bold">{step.title}</p>
									<p class="mt-1 line-clamp-2 opacity-80">{step.description}</p>
								</div>
							{/each}
						</div>
					</div>
				</div>

				{#if errorMessage}
					<div class="mt-6 rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
						<strong>Chyba:</strong>
						{errorMessage}
					</div>
				{/if}
			</div>
		</section>

		<section class="px-4 pb-24 sm:px-6 lg:px-8">
			<div class="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[0.82fr_1.18fr]">
				<div class="space-y-6">
					<div class="rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-xl shadow-slate-950/5 backdrop-blur sm:p-6">
						<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p class="text-sm font-bold uppercase tracking-wide text-blue-700">Krok 1</p>
								<h2 class="mt-1 text-2xl font-black text-slate-950">GPS poloha</h2>
								<p class="mt-2 text-sm leading-6 text-slate-600">
									Nejdřív načteme polohu zařízení. Na mobilu bývá přesnost výrazně lepší.
								</p>
							</div>

							<span class="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
								Geolocation
							</span>
						</div>

						<button
							type="button"
							onclick={handleGetLocation}
							disabled={isGettingLocation}
							class="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
						>
							<span>{isGettingLocation ? 'Zjišťuji polohu…' : 'Zjistit moji polohu'}</span>
						</button>

						{#if position}
							<div class="mt-5 grid gap-3 sm:grid-cols-2">
								<div class="rounded-2xl bg-slate-50 p-4">
									<p class="text-xs font-bold uppercase tracking-wide text-slate-500">Latitude</p>
									<p class="mt-1 font-mono text-sm font-bold text-slate-950">
										{formatNumber(position.latitude)}
									</p>
								</div>

								<div class="rounded-2xl bg-slate-50 p-4">
									<p class="text-xs font-bold uppercase tracking-wide text-slate-500">Longitude</p>
									<p class="mt-1 font-mono text-sm font-bold text-slate-950">
										{formatNumber(position.longitude)}
									</p>
								</div>

								<div class="rounded-2xl bg-slate-50 p-4">
									<p class="text-xs font-bold uppercase tracking-wide text-slate-500">Přesnost</p>
									<p class="mt-1 text-sm font-bold text-slate-950">
										{position.accuracy === null ? 'Neznámá' : `${Math.round(position.accuracy)} m`}
									</p>
								</div>

								<div class="rounded-2xl bg-slate-50 p-4">
									<p class="text-xs font-bold uppercase tracking-wide text-slate-500">Čas</p>
									<p class="mt-1 text-sm font-bold text-slate-950">
										{new Date(position.timestamp).toLocaleString('cs-CZ')}
									</p>
								</div>
							</div>
						{/if}
					</div>

					<div class="rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-xl shadow-slate-950/5 backdrop-blur sm:p-6">
						<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<p class="text-sm font-bold uppercase tracking-wide text-blue-700">Krok 2</p>
								<h2 class="mt-1 text-2xl font-black text-slate-950">Kandidátní parcely</h2>
								<p class="mt-2 text-sm leading-6 text-slate-600">
									Server použije GPS bod, S-JTSK převod a dotaz na API KN.
								</p>
							</div>

							<span class="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
								ČÚZK API
							</span>
						</div>

						<div class="mt-5 rounded-3xl bg-slate-50 p-4">
							<div class="flex items-center justify-between gap-4">
								<label class="block flex-1">
									<span class="mb-1 block text-sm font-bold text-slate-700">Radius hledání</span>
									<input
										bind:value={radiusMeters}
										type="range"
										min="5"
										max="35"
										step="5"
										class="w-full accent-blue-700"
									/>
								</label>

								<div class="grid h-16 w-16 place-items-center rounded-2xl bg-white text-sm font-black text-slate-950 shadow-sm">
									{radiusMeters} m
								</div>
							</div>

							<p class="mt-3 text-xs leading-5 text-slate-500">
								Limit polygonu v API je 5000 m², proto držíme bezpečné maximum 35 m.
							</p>
						</div>

						<button
							type="button"
							onclick={handleFindParcel}
							disabled={!position || isFindingParcel}
							class="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-blue-700/20 transition hover:-translate-y-0.5 hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
						>
							<span>{isFindingParcel ? 'Volám API KN…' : 'Najít kandidátní parcely'}</span>
						</button>

						{#if lookup}
							<div class="mt-5 space-y-4">
								<div class="grid gap-3 sm:grid-cols-2">
									<div class="rounded-2xl bg-slate-50 p-4">
										<p class="text-xs font-bold uppercase tracking-wide text-slate-500">Režim</p>
										<p class="mt-1 text-sm font-bold text-slate-950">
											{lookup.mode === 'real' ? 'Reálné ČÚZK API' : 'Mock režim'}
										</p>
									</div>

									<div class="rounded-2xl bg-slate-50 p-4">
										<p class="text-xs font-bold uppercase tracking-wide text-slate-500">Nalezeno</p>
										<p class="mt-1 text-sm font-bold text-slate-950">
											{lookup.parcels.length} parcel
										</p>
									</div>

									<div class="rounded-2xl bg-slate-50 p-4">
										<p class="text-xs font-bold uppercase tracking-wide text-slate-500">S-JTSK X</p>
										<p class="mt-1 font-mono text-sm font-bold text-slate-950">
											{lookup.center.sjtskX === null ? '—' : lookup.center.sjtskX}
										</p>
									</div>

									<div class="rounded-2xl bg-slate-50 p-4">
										<p class="text-xs font-bold uppercase tracking-wide text-slate-500">S-JTSK Y</p>
										<p class="mt-1 font-mono text-sm font-bold text-slate-950">
											{lookup.center.sjtskY === null ? '—' : lookup.center.sjtskY}
										</p>
									</div>
								</div>

								{#if lookup.warning}
									<div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
										{lookup.warning}
									</div>
								{/if}

								{#if lookup.messages.length}
									<div class="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
										<p class="font-bold">Zprávy z API</p>
										<ul class="mt-2 list-disc space-y-1 pl-5">
											{#each lookup.messages as message, index (message + index)}
												<li>{message}</li>
											{/each}
										</ul>
									</div>
								{/if}

								{#if lookup.parcels.length}
									<div class="space-y-3">
										{#each lookup.parcels as parcel (parcel.id)}
											<label
												class={`block cursor-pointer rounded-3xl border p-4 transition ${
													selectedParcelId === parcel.id
														? 'border-blue-500 bg-blue-50 ring-4 ring-blue-100'
														: 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'
												}`}
											>
												<div class="flex gap-3">
													<input
														bind:group={selectedParcelId}
														value={parcel.id}
														type="radio"
														class="mt-1 accent-blue-700"
													/>

													<div class="min-w-0 flex-1">
														<div class="flex flex-wrap items-center justify-between gap-2">
															<p class="text-base font-black text-slate-950">
																Parcela č. {parcel.parcelNumber}
															</p>

															<span class="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm">
																LV {formatOptional(parcel.lv)}
															</span>
														</div>

														<p class="mt-1 text-sm text-slate-600">
															{parcel.katastralniUzemiNazev}
															{parcel.katastralniUzemiKod
																? `, kód KÚ ${parcel.katastralniUzemiKod}`
																: ''}
														</p>

														<div class="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
															<div class="rounded-2xl bg-white/80 p-3">
																<p class="text-slate-400">Výměra</p>
																<p class="font-bold text-slate-950">
																	{formatOptional(parcel.vymera)} m²
																</p>
															</div>

															<div class="rounded-2xl bg-white/80 p-3">
																<p class="text-slate-400">Druh</p>
																<p class="font-bold text-slate-950">
																	{formatOptional(parcel.druhPozemku)}
																</p>
															</div>

															<div class="rounded-2xl bg-white/80 p-3">
																<p class="text-slate-400">Využití</p>
																<p class="font-bold text-slate-950">
																	{formatOptional(parcel.zpusobVyuziti)}
																</p>
															</div>
														</div>
													</div>
												</div>
											</label>
										{/each}
									</div>
								{:else}
									<p class="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
										Nenašla se žádná parcela. Zkus přesnější GPS pozici.
									</p>
								{/if}
							</div>
						{/if}
					</div>

					<div class="rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-xl shadow-slate-950/5 backdrop-blur sm:p-6">
						<div>
							<p class="text-sm font-bold uppercase tracking-wide text-blue-700">Krok 3</p>
							<h2 class="mt-1 text-2xl font-black text-slate-950">Údaje do dopisu</h2>
							<p class="mt-2 text-sm leading-6 text-slate-600">
								Doplň vlastníka, svoje údaje a nabídku. PDF se bude aktualizovat automaticky.
							</p>
						</div>

						<div class="mt-5 grid gap-4 sm:grid-cols-2">
							<label class="block">
								<span class="mb-1 block text-sm font-bold text-slate-700">Jméno vlastníka</span>
								<input
									bind:value={form.recipientName}
									type="text"
									placeholder="Jan Novák"
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
								/>
							</label>

							<label class="block">
								<span class="mb-1 block text-sm font-bold text-slate-700">Adresa vlastníka</span>
								<input
									bind:value={form.recipientAddress}
									type="text"
									placeholder="Ulice 123, 110 00 Praha"
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
								/>
							</label>

							<label class="block">
								<span class="mb-1 block text-sm font-bold text-slate-700">Tvoje jméno / firma</span>
								<input
									bind:value={form.buyerName}
									type="text"
									placeholder="Kupující s.r.o."
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
								/>
							</label>

							<label class="block">
								<span class="mb-1 block text-sm font-bold text-slate-700">Tvoje adresa</span>
								<input
									bind:value={form.buyerAddress}
									type="text"
									placeholder="Tvoje adresa"
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
								/>
							</label>

							<label class="block">
								<span class="mb-1 block text-sm font-bold text-slate-700">E-mail</span>
								<input
									bind:value={form.buyerEmail}
									type="email"
									placeholder="email@example.cz"
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
								/>
							</label>

							<label class="block">
								<span class="mb-1 block text-sm font-bold text-slate-700">Telefon</span>
								<input
									bind:value={form.buyerPhone}
									type="tel"
									placeholder="+420 777 123 456"
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
								/>
							</label>

							<label class="block sm:col-span-2">
								<span class="mb-1 block text-sm font-bold text-slate-700">Nabízená částka</span>
								<input
									bind:value={form.offerAmount}
									type="text"
									placeholder="např. 250 000 Kč"
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
								/>
							</label>

							<label class="block sm:col-span-2">
								<span class="mb-1 block text-sm font-bold text-slate-700">Vlastní text nabídky</span>
								<textarea
									bind:value={form.customMessage}
									rows="5"
									class="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
								></textarea>
							</label>
						</div>
					</div>
				</div>

				<div class="space-y-6 xl:sticky xl:top-6 xl:self-start">
					<div class="rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-xl shadow-slate-950/5 backdrop-blur sm:p-6">
						<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
							<div>
								<p class="text-sm font-bold uppercase tracking-wide text-blue-700">Krok 4</p>
								<h2 class="mt-1 text-2xl font-black text-slate-950">PDF výstup</h2>
								<p class="mt-2 text-sm leading-6 text-slate-600">
									Vyber styl dopisu. Náhled se po změně automaticky překreslí.
								</p>
							</div>

							<div class="rounded-2xl bg-slate-50 px-4 py-3">
								<p class="text-xs font-bold uppercase tracking-wide text-slate-500">Aktuální styl</p>
								<p class="text-sm font-black text-slate-950">{selectedVariantOption.badge}</p>
							</div>
						</div>

						<div class="mt-5 grid gap-3 md:grid-cols-3">
							{#each letterVariants as variant (variant.id)}
								<label
									class={`group cursor-pointer rounded-3xl border p-4 transition ${
										pdfVariant === variant.id
											? 'border-blue-500 bg-blue-50 ring-4 ring-blue-100'
											: 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'
									}`}
								>
									<div class="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
										<div class={`h-2 ${variant.accent}`}></div>
										<div class="space-y-2 p-3">
											<div class="h-2 w-2/3 rounded bg-slate-300"></div>
											<div class="h-2 w-full rounded bg-slate-100"></div>
											<div class="h-2 w-5/6 rounded bg-slate-100"></div>
											<div class="mt-3 h-10 rounded bg-slate-50"></div>
										</div>
									</div>

									<div class="flex items-start gap-3">
										<input bind:group={pdfVariant} value={variant.id} type="radio" class="mt-1 accent-blue-700" />

										<div>
											<div class="flex flex-wrap items-center gap-2">
												<p class="font-black text-slate-950">{variant.title}</p>
												<span class="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-blue-700 shadow-sm">
													{variant.badge}
												</span>
											</div>
											<p class="mt-1 text-xs leading-5 text-slate-600">{variant.description}</p>
										</div>
									</div>
								</label>
							{/each}
						</div>

						<div class="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
							<div class="rounded-2xl bg-slate-50 p-4">
								<p class="text-xs font-bold uppercase tracking-wide text-slate-500">Soubor</p>
								<p class="mt-1 break-all text-sm font-bold text-slate-950">{getPdfFileName()}.pdf</p>
							</div>

							<button
								type="button"
								onclick={copyLetter}
								class="rounded-2xl bg-slate-950 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-slate-950/15 transition hover:-translate-y-0.5 hover:bg-slate-800"
							>
								Kopírovat text
							</button>

							<button
								type="button"
								onclick={downloadPdf}
								disabled={isGeneratingPdf}
								class="rounded-2xl bg-blue-700 px-5 py-4 text-sm font-bold text-white shadow-lg shadow-blue-700/20 transition hover:-translate-y-0.5 hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
							>
								{isGeneratingPdf ? 'Generuji…' : 'Stáhnout PDF'}
							</button>
						</div>

						{#if copyMessage}
							<p class="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
								{copyMessage}
							</p>
						{/if}

						{#if pdfMessage}
							<p class="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
								{pdfMessage}
							</p>
						{/if}

						<div class="mt-5">
							<details class="group rounded-3xl border border-slate-200 bg-slate-50 p-4">
								<summary class="cursor-pointer list-none text-sm font-black text-slate-950">
									<span class="inline-flex items-center justify-between gap-3">
										Text dopisu
										<span class="text-xs font-bold text-slate-500 group-open:hidden">zobrazit</span>
										<span class="hidden text-xs font-bold text-slate-500 group-open:inline">skrýt</span>
									</span>
								</summary>

								<textarea
									readonly
									value={letterText}
									rows="12"
									class="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 font-mono text-xs leading-6 text-slate-800 outline-none"
								></textarea>
							</details>
						</div>
					</div>

					<div class="rounded-[2rem] border border-white/70 bg-white/95 p-4 shadow-xl shadow-slate-950/5 backdrop-blur sm:p-6">
						<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
							<div>
								<p class="text-sm font-bold uppercase tracking-wide text-blue-700">Živý náhled</p>
								<h2 class="mt-1 text-2xl font-black text-slate-950">PDF preview</h2>
							</div>

							<div class="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
								{#if isGeneratingPreview}
									<span class="inline-flex h-2 w-2 animate-pulse rounded-full bg-blue-600"></span>
									Generuji náhled…
								{:else}
									<span class="inline-flex h-2 w-2 rounded-full bg-emerald-600"></span>
									Aktuální
								{/if}
							</div>
						</div>

						{#if previewError}
							<div class="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
								<strong>Chyba náhledu:</strong>
								{previewError}
							</div>
						{/if}

						{#if previewPdfUrl}
							<div class="overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 shadow-inner">
								<iframe
									title="Náhled PDF dopisu"
									src={previewPdfUrl}
									class="h-[620px] w-full bg-white sm:h-[760px] xl:h-[calc(100vh-16rem)] xl:min-h-[620px]"
								></iframe>
							</div>
						{:else}
							<div class="flex h-[460px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
								<div>
									<div class="mx-auto mb-4 h-12 w-12 animate-pulse rounded-2xl bg-blue-100"></div>
									<p class="font-bold text-slate-700">Připravuji první náhled PDF…</p>
									<p class="mt-1 text-xs text-slate-500">Po vyplnění údajů se zde zobrazí živý náhled.</p>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</section>

		<div class="fixed inset-x-0 bottom-0 z-20 border-t border-white/20 bg-slate-950/90 px-4 py-3 backdrop-blur lg:hidden">
			<div class="mx-auto flex max-w-7xl items-center gap-2">
				<button
					type="button"
					onclick={handleGetLocation}
					disabled={isGettingLocation}
					class="flex-1 rounded-2xl bg-white px-3 py-3 text-xs font-black text-slate-950 disabled:opacity-60"
				>
					GPS
				</button>

				<button
					type="button"
					onclick={handleFindParcel}
					disabled={!position || isFindingParcel}
					class="flex-1 rounded-2xl bg-blue-600 px-3 py-3 text-xs font-black text-white disabled:opacity-60"
				>
					Parcela
				</button>

				<button
					type="button"
					onclick={downloadPdf}
					disabled={isGeneratingPdf}
					class="flex-1 rounded-2xl bg-emerald-500 px-3 py-3 text-xs font-black text-white disabled:opacity-60"
				>
					PDF
				</button>
			</div>
		</div>
	</div>
</main>