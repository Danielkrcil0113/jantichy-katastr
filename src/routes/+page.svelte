<script lang="ts">
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
	};

	const letterVariants: LetterVariantOption[] = [
		{
			id: 'classic',
			title: 'Varianta 1',
			description: 'Klasický úřední dopis, jednoduchý a seriózní.',
			badge: 'Klasická'
		},
		{
			id: 'modern',
			title: 'Varianta 2',
			description: 'Moderní obchodní vzhled s modrým pruhem a informační kartou.',
			badge: 'Moderní'
		},
		{
			id: 'premium',
			title: 'Varianta 3',
			description: 'Prémiovější dopis s jemným rámečkem a teplejším vzhledem.',
			badge: 'Prémiová'
		}
	];

	let position = $state<GeoPosition | null>(null);
	let lookup = $state<ParcelLookupResponse | null>(null);
	let selectedParcelId = $state('');

	let isGettingLocation = $state(false);
	let isFindingParcel = $state(false);
	let isGeneratingPdf = $state(false);

	let errorMessage = $state('');
	let copyMessage = $state('');
	let pdfMessage = $state('');

	let radiusMeters = $state(25);
	let pdfVariant = $state<LetterVariant>('classic');

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
		const parcelText = getParcelText(selectedParcel);
		const message = form.customMessage.trim();

		return `${recipientName}
${recipientAddress}

${buyerName}
${buyerAddress}

Věc: Nezávazná nabídka odkupu pozemku

Vážená paní, vážený pane,

obracím se na Vás jako na vlastníka ${parcelText}.

${message}

Za výše uvedený pozemek bych Vám rád nabídl částku ${offerAmount}. Tato nabídka je nezávazná a slouží jako podklad pro případné další jednání.

V případě Vašeho zájmu mě prosím kontaktujte na e-mailu ${buyerEmail} nebo telefonicky na čísle ${buyerPhone}.

Děkuji Vám za zvážení mé nabídky.

S pozdravem

${buyerName}

V ${today()}`;
	}

	let letterText = $derived(getLetterText());

	function getPdfFileName(): string {
		const parcelPart = selectedParcel?.parcelNumber.replace('/', '-') || 'pozemek';
		const variantPart = pdfVariant;

		return `nabidka-odkupu-${parcelPart}-${variantPart}`;
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
				body: JSON.stringify({
					variant: pdfVariant,
					letterText,
					parcelSummary: getParcelText(selectedParcel),
					recipientName: form.recipientName,
					buyerName: form.buyerName,
					offerAmount: form.offerAmount,
					fileName: getPdfFileName()
				})
			});

			if (!response.ok) {
				const text = await response.text();

				try {
					const parsed = JSON.parse(text);
					throw new Error(parsed.message || 'PDF se nepodařilo vygenerovat.');
				} catch {
					throw new Error(text || 'PDF se nepodařilo vygenerovat.');
				}
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

<main class="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
	<div class="mx-auto max-w-6xl">
		<header class="mb-8">
			<p class="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-700">
				REST API KN + PDF generátor
			</p>
			<h1 class="text-3xl font-bold tracking-tight text-gray-950 sm:text-5xl">
				Nabídka odkupu pozemku podle GPS
			</h1>
			<p class="mt-4 max-w-3xl text-base leading-7 text-gray-600">
				Aplikace zjistí GPS polohu, najde kandidátní parcely přes backend a připraví dopis ve
				třech grafických variantách. Vlastníka zatím doplňujeme ručně kvůli pravidlům pro osobní
				údaje a automatizovaný přístup.
			</p>
		</header>

		{#if errorMessage}
			<div class="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
				<strong>Chyba:</strong>
				{errorMessage}
			</div>
		{/if}

		<div class="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
			<section class="space-y-6">
				<div class="rounded-3xl border border-white/80 bg-white/85 p-6 shadow-sm backdrop-blur">
					<div class="mb-4 flex items-start justify-between gap-4">
						<div>
							<p class="text-sm font-semibold text-blue-700">Krok 1</p>
							<h2 class="mt-1 text-xl font-bold text-gray-950">Zjistit GPS polohu</h2>
						</div>
						<span class="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
							Geolocation
						</span>
					</div>

					<p class="mb-5 text-sm leading-6 text-gray-600">
						Prohlížeč se zeptá na povolení polohy. Na mobilu bude přesnost obvykle lepší než
						na desktopu.
					</p>

					<button
						type="button"
						onclick={handleGetLocation}
						disabled={isGettingLocation}
						class="w-full rounded-2xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isGettingLocation ? 'Zjišťuji polohu…' : 'Zjistit moji polohu'}
					</button>

					{#if position}
						<div class="mt-5 rounded-2xl bg-gray-50 p-4 text-sm text-gray-700">
							<div class="grid gap-3 sm:grid-cols-2">
								<div>
									<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
										Latitude
									</p>
									<p class="mt-1 font-mono">{formatNumber(position.latitude)}</p>
								</div>

								<div>
									<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
										Longitude
									</p>
									<p class="mt-1 font-mono">{formatNumber(position.longitude)}</p>
								</div>

								<div>
									<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
										Přesnost
									</p>
									<p class="mt-1">
										{position.accuracy === null ? 'Neznámá' : `${Math.round(position.accuracy)} m`}
									</p>
								</div>

								<div>
									<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Čas</p>
									<p class="mt-1">{new Date(position.timestamp).toLocaleString('cs-CZ')}</p>
								</div>
							</div>
						</div>
					{/if}
				</div>

				<div class="rounded-3xl border border-white/80 bg-white/85 p-6 shadow-sm backdrop-blur">
					<div class="mb-4 flex items-start justify-between gap-4">
						<div>
							<p class="text-sm font-semibold text-blue-700">Krok 2</p>
							<h2 class="mt-1 text-xl font-bold text-gray-950">Najít parcely přes API KN</h2>
						</div>
						<span class="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
							ČÚZK API
						</span>
					</div>

					<label class="mb-5 block">
						<span class="mb-1 block text-sm font-medium text-gray-700">
							Radius hledání kolem GPS bodu
						</span>
						<input
							bind:value={radiusMeters}
							type="number"
							min="5"
							max="35"
							step="5"
							class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						/>
						<span class="mt-1 block text-xs text-gray-500">
							ČÚZK API omezuje plochu polygonu na 5000 m², proto používáme max. 35 m.
						</span>
					</label>

					<button
						type="button"
						onclick={handleFindParcel}
						disabled={!position || isFindingParcel}
						class="w-full rounded-2xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isFindingParcel ? 'Volám API KN…' : 'Najít kandidátní parcely'}
					</button>

					{#if lookup}
						<div class="mt-5 space-y-4">
							<div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm">
								<div class="grid gap-3 sm:grid-cols-2">
									<div>
										<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Režim</p>
										<p class="mt-1 font-semibold text-gray-950">
											{lookup.mode === 'real' ? 'Reálné ČÚZK API' : 'Mock režim'}
										</p>
									</div>

									<div>
										<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
											Radius
										</p>
										<p class="mt-1 font-semibold text-gray-950">
											{lookup.searchRadiusMeters} m
										</p>
									</div>

									<div>
										<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
											S-JTSK X
										</p>
										<p class="mt-1 font-mono">
											{lookup.center.sjtskX === null ? '—' : lookup.center.sjtskX}
										</p>
									</div>

									<div>
										<p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
											S-JTSK Y
										</p>
										<p class="mt-1 font-mono">
											{lookup.center.sjtskY === null ? '—' : lookup.center.sjtskY}
										</p>
									</div>
								</div>
							</div>

							{#if lookup.warning}
								<div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
									{lookup.warning}
								</div>
							{/if}

							{#if lookup.messages.length}
								<div class="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
									<p class="font-semibold">Zprávy z API:</p>
									<ul class="mt-2 list-disc space-y-1 pl-5">
										{#each lookup.messages as message, index (message + index)}
											<li>{message}</li>
										{/each}
									</ul>
								</div>
							{/if}

							{#if lookup.parcels.length}
								<div class="space-y-3">
									<p class="text-sm font-bold text-gray-950">
										Kandidátní parcely: {lookup.parcels.length}
									</p>

									{#each lookup.parcels as parcel (parcel.id)}
										<label
											class={`block cursor-pointer rounded-2xl border bg-white p-4 transition hover:border-blue-300 ${
												selectedParcelId === parcel.id
													? 'border-blue-500 ring-4 ring-blue-100'
													: 'border-gray-200'
											}`}
										>
											<div class="flex gap-3">
												<input
													bind:group={selectedParcelId}
													value={parcel.id}
													type="radio"
													class="mt-1"
												/>

												<div class="min-w-0 flex-1">
													<p class="font-semibold text-gray-950">
														Parcela č. {parcel.parcelNumber}
													</p>

													<p class="mt-1 text-sm text-gray-600">
														{parcel.katastralniUzemiNazev}
														{parcel.katastralniUzemiKod
															? `, kód KÚ ${parcel.katastralniUzemiKod}`
															: ''}
													</p>

													<div class="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-2">
														<p>Výměra: <strong>{formatOptional(parcel.vymera)} m²</strong></p>
														<p>LV: <strong>{formatOptional(parcel.lv)}</strong></p>
														<p>Druh: <strong>{formatOptional(parcel.druhPozemku)}</strong></p>
														<p>
															Využití: <strong>{formatOptional(parcel.zpusobVyuziti)}</strong>
														</p>
													</div>
												</div>
											</div>
										</label>
									{/each}
								</div>
							{:else}
								<p class="rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">
									Nenašla se žádná parcela. Zkus přesnější GPS pozici.
								</p>
							{/if}
						</div>
					{/if}
				</div>
			</section>

			<section class="rounded-3xl border border-white/80 bg-white/90 p-6 shadow-sm backdrop-blur">
				<div class="mb-6">
					<p class="text-sm font-semibold text-blue-700">Krok 3</p>
					<h2 class="mt-1 text-xl font-bold text-gray-950">Vygenerovat dopis a PDF</h2>
					<p class="mt-2 text-sm leading-6 text-gray-600">
						Vlastníka zatím doplň ručně. Vybraná parcela se propíše do textu automaticky.
					</p>
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<label class="block">
						<span class="mb-1 block text-sm font-medium text-gray-700">Jméno vlastníka</span>
						<input
							bind:value={form.recipientName}
							type="text"
							placeholder="Jan Novák"
							class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						/>
					</label>

					<label class="block">
						<span class="mb-1 block text-sm font-medium text-gray-700">Adresa vlastníka</span>
						<input
							bind:value={form.recipientAddress}
							type="text"
							placeholder="Ulice 123, 110 00 Praha"
							class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						/>
					</label>

					<label class="block">
						<span class="mb-1 block text-sm font-medium text-gray-700">Tvoje jméno / firma</span>
						<input
							bind:value={form.buyerName}
							type="text"
							placeholder="Kupující s.r.o."
							class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						/>
					</label>

					<label class="block">
						<span class="mb-1 block text-sm font-medium text-gray-700">Tvoje adresa</span>
						<input
							bind:value={form.buyerAddress}
							type="text"
							placeholder="Tvoje adresa"
							class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						/>
					</label>

					<label class="block">
						<span class="mb-1 block text-sm font-medium text-gray-700">E-mail</span>
						<input
							bind:value={form.buyerEmail}
							type="email"
							placeholder="email@example.cz"
							class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						/>
					</label>

					<label class="block">
						<span class="mb-1 block text-sm font-medium text-gray-700">Telefon</span>
						<input
							bind:value={form.buyerPhone}
							type="tel"
							placeholder="+420 777 123 456"
							class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						/>
					</label>

					<label class="block sm:col-span-2">
						<span class="mb-1 block text-sm font-medium text-gray-700">Nabízená částka</span>
						<input
							bind:value={form.offerAmount}
							type="text"
							placeholder="např. 250 000 Kč"
							class="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						/>
					</label>

					<label class="block sm:col-span-2">
						<span class="mb-1 block text-sm font-medium text-gray-700">Vlastní text nabídky</span>
						<textarea
							bind:value={form.customMessage}
							rows="5"
							class="w-full resize-y rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
						></textarea>
					</label>
				</div>

				<div class="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
					<p class="mb-3 text-sm font-bold text-gray-950">Vyber grafickou variantu PDF</p>

					<div class="grid gap-3 sm:grid-cols-3">
						{#each letterVariants as variant (variant.id)}
							<label
								class={`cursor-pointer rounded-2xl border bg-white p-4 transition ${
									pdfVariant === variant.id
										? 'border-blue-500 ring-4 ring-blue-100'
										: 'border-gray-200 hover:border-blue-300'
								}`}
							>
								<div class="mb-3 flex items-center justify-between gap-2">
									<input bind:group={pdfVariant} value={variant.id} type="radio" />
									<span class="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">
										{variant.badge}
									</span>
								</div>

								<p class="font-semibold text-gray-950">{variant.title}</p>
								<p class="mt-1 text-xs leading-5 text-gray-600">{variant.description}</p>
							</label>
						{/each}
					</div>
				</div>

				<div class="mt-6">
					<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
						<h3 class="text-base font-bold text-gray-950">Náhled textu dopisu</h3>

						<div class="flex gap-2">
							<button
								type="button"
								onclick={copyLetter}
								class="rounded-xl bg-gray-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-gray-800"
							>
								Kopírovat
							</button>

							<button
								type="button"
								onclick={downloadPdf}
								disabled={isGeneratingPdf}
								class="rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{isGeneratingPdf ? 'Generuji PDF…' : 'Stáhnout PDF'}
							</button>
						</div>
					</div>

					{#if copyMessage}
						<p class="mb-3 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
							{copyMessage}
						</p>
					{/if}

					{#if pdfMessage}
						<p class="mb-3 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
							{pdfMessage}
						</p>
					{/if}

					<textarea
						readonly
						value={letterText}
						rows="22"
						class="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 font-mono text-xs leading-6 text-gray-800 outline-none"
					></textarea>
				</div>
			</section>
		</div>
	</div>
</main>