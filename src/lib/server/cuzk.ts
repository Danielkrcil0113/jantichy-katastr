import { env } from '$env/dynamic/private';
import type { ParcelCandidate } from '$lib/types';
import { createSquarePolygon, wgs84ToSjtsk } from './geo';

type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAny(obj: unknown, keys: string[]): unknown {
	if (!isRecord(obj)) return undefined;

	for (const key of keys) {
		if (key in obj) return obj[key];
	}

	return undefined;
}

function getString(obj: unknown, keys: string[], fallback = ''): string {
	const value = getAny(obj, keys);

	if (typeof value === 'string') return value;
	if (typeof value === 'number') return String(value);

	return fallback;
}

function getNumber(obj: unknown, keys: string[]): number | null {
	const value = getAny(obj, keys);

	if (typeof value === 'number' && Number.isFinite(value)) return value;

	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

function getNestedString(obj: unknown, keys: string[], nestedKeys: string[], fallback = ''): string {
	const nested = getAny(obj, keys);
	return getString(nested, nestedKeys, fallback);
}

function getNestedNumber(obj: unknown, keys: string[], nestedKeys: string[]): number | null {
	const nested = getAny(obj, keys);
	return getNumber(nested, nestedKeys);
}

function extractDataArray(raw: unknown): unknown[] {
	if (Array.isArray(raw)) return raw;

	const data = getAny(raw, ['data', 'Data']);

	if (Array.isArray(data)) return data;

	return [];
}

function extractDataObject(raw: unknown): unknown {
	return getAny(raw, ['data', 'Data']) ?? raw;
}

function extractMessages(raw: unknown): string[] {
	const zpravy = getAny(raw, ['zpravy', 'Zpravy']);

	if (!Array.isArray(zpravy)) return [];

	return zpravy
		.map((item) => getString(item, ['text', 'Text'], ''))
		.filter((message) => message.trim().length > 0);
}

function extractAktualnostDat(raw: unknown): string | null {
	const value = getAny(raw, ['aktualnostDatK', 'AktualnostDatK']);
	return typeof value === 'string' ? value : null;
}

function extractProvedenoVolani(raw: unknown): number | null {
	return getNumber(raw, ['provedenoVolani', 'ProvedenoVolani']);
}

function formatParcelNumber(parcel: unknown): string {
	const kmenove = getNumber(parcel, ['kmenoveCisloParcely', 'kmenove_cislo_parcely']);
	const poddeleni = getNumber(parcel, ['poddeleniCislaParcely', 'poddeleni_cisla_parcely']);

	if (!kmenove) return 'neznámé číslo';

	return poddeleni ? `${kmenove}/${poddeleni}` : String(kmenove);
}

function normalizeParcel(parcel: unknown, source: 'real' | 'mock'): ParcelCandidate {
	const id = getString(parcel, ['id', 'Id'], crypto.randomUUID());

	const definicniBod = getAny(parcel, ['definicniBod', 'definicni_bod']);
	const lv = getAny(parcel, ['lv', 'LV']);

	return {
		id,
		parcelNumber: formatParcelNumber(parcel),
		typParcely: getString(parcel, ['typParcely', 'typ_parcely'], '') || null,
		druhCislovaniParcely:
			getAny(parcel, ['druhCislovaniParcely', 'druh_cislovani_parcely']) as string | number | null,
		katastralniUzemiKod: getNestedNumber(
			parcel,
			['katastralniUzemi', 'katastralni_uzemi'],
			['kod', 'Kod']
		),
		katastralniUzemiNazev: getNestedString(
			parcel,
			['katastralniUzemi', 'katastralni_uzemi'],
			['nazev', 'Nazev'],
			'neznámé katastrální území'
		),
		vymera: getNumber(parcel, ['vymera', 'Vymera']),
		lv:
			getString(lv, ['cislo', 'Cislo', 'cisloLv', 'cislo_lv'], '') ||
			getString(parcel, ['cisloLv', 'cislo_lv'], '') ||
			null,
		druhPozemku:
			getNestedString(parcel, ['druhPozemku', 'druh_pozemku'], ['nazev', 'Nazev'], '') || null,
		zpusobVyuziti:
			getNestedString(parcel, ['zpusobVyuziti', 'zpusob_vyuziti'], ['nazev', 'Nazev'], '') || null,
		definicniBodX: getNumber(definicniBod, ['x', 'X']),
		definicniBodY: getNumber(definicniBod, ['y', 'Y']),
		source,
		raw: parcel
	};
}

async function cuzkGet(path: string, searchParams?: URLSearchParams): Promise<unknown> {
	const apiKey = env.CUZK_API_KEY;
	const baseUrl = env.CUZK_API_BASE_URL || 'https://api-kn.cuzk.gov.cz';

	if (!apiKey) {
		throw new Error('Chybí CUZK_API_KEY v .env.');
	}

	const url = new URL(path, baseUrl);

	if (searchParams) {
		for (const [key, value] of searchParams.entries()) {
			url.searchParams.set(key, value);
		}
	}

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			ApiKey: apiKey
		}
	});

	const contentType = response.headers.get('content-type') || '';
	const rawBody = contentType.includes('application/json') ? await response.json() : await response.text();

	if (!response.ok) {
		throw new Error(
			`ČÚZK API vrátilo HTTP ${response.status}: ${
				typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
			}`
		);
	}

	return rawBody;
}

function createMockParcel(latitude: number, longitude: number): ParcelCandidate {
	const parcelBase = Math.abs(Math.round(latitude * 10000)) % 9000;
	const parcelSuffix = Math.abs(Math.round(longitude * 10000)) % 99;

	return {
		id: `mock-${parcelBase}-${parcelSuffix}`,
		parcelNumber: `${parcelBase}/${parcelSuffix || 1}`,
		typParcely: 'PKN',
		druhCislovaniParcely: 2,
		katastralniUzemiKod: 999999,
		katastralniUzemiNazev: 'Demo katastrální území',
		vymera: 1234,
		lv: null,
		druhPozemku: 'orná půda',
		zpusobVyuziti: null,
		definicniBodX: null,
		definicniBodY: null,
		source: 'mock',
		raw: {
			latitude,
			longitude,
			note: 'Toto je mock data režim.'
		}
	};
}

export async function findParcelsByGps(input: {
	latitude: number;
	longitude: number;
	accuracy: number | null;
	radiusMeters?: number | null;
}) {
	const useMock = env.CUZK_API_USE_MOCK === 'true' || !env.CUZK_API_KEY;

	const radiusFromAccuracy =
		input.accuracy && Number.isFinite(input.accuracy) ? Math.ceil(input.accuracy) : 50;

	const searchRadiusMeters = Math.max(
		25,
		Math.min(input.radiusMeters ?? radiusFromAccuracy, 150)
	);

	if (useMock) {
		return {
			mode: 'mock' as const,
			center: {
				latitude: input.latitude,
				longitude: input.longitude,
				sjtskX: null,
				sjtskY: null
			},
			searchRadiusMeters,
			parcels: [createMockParcel(input.latitude, input.longitude)],
			messages: [
				'Běžím v MOCK režimu. Nastav CUZK_API_KEY a CUZK_API_USE_MOCK=false pro reálné API.'
			],
			aktualnostDatK: null,
			provedenoVolani: null,
			warning: 'Mock režim — data nejsou z katastru.'
		};
	}

	const center = wgs84ToSjtsk(input.latitude, input.longitude);
	const polygon = createSquarePolygon(center, searchRadiusMeters);

	const searchParams = new URLSearchParams({
		SeznamSouradnic: JSON.stringify(polygon.map((point) => ({ y: point.y, x: point.x })))
	});

	const polygonRaw = await cuzkGet('/api/v1/Parcely/Polygon', searchParams);
	const parcelDefs = extractDataArray(polygonRaw);

	const detailedParcels: ParcelCandidate[] = [];

	for (const parcelDef of parcelDefs.slice(0, 8)) {
		const id = getString(parcelDef, ['id', 'Id'], '');

		if (!id) {
			detailedParcels.push(normalizeParcel(parcelDef, 'real'));
			continue;
		}

		try {
			const detailRaw = await cuzkGet(`/api/v1/Parcely/${encodeURIComponent(id)}`);
			const detail = extractDataObject(detailRaw);
			detailedParcels.push(normalizeParcel(detail, 'real'));
		} catch {
			detailedParcels.push(normalizeParcel(parcelDef, 'real'));
		}
	}

	return {
		mode: 'real' as const,
		center: {
			latitude: input.latitude,
			longitude: input.longitude,
			sjtskX: center.x,
			sjtskY: center.y
		},
		searchRadiusMeters,
		parcels: detailedParcels,
		messages: extractMessages(polygonRaw),
		aktualnostDatK: extractAktualnostDat(polygonRaw),
		provedenoVolani: extractProvedenoVolani(polygonRaw),
		warning:
			detailedParcels.length === 0
				? 'API nevrátilo žádnou parcelu. Zkus větší radius nebo přesnější GPS.'
				: null
	};
}