import { error, json, type RequestHandler } from '@sveltejs/kit';
import { findParcelsByGps } from '$lib/server/cuzk';

type ParcelRequestBody = {
	latitude?: unknown;
	longitude?: unknown;
	accuracy?: unknown;
	radiusMeters?: unknown;
};

function toNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;

	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: ParcelRequestBody;

	try {
		body = await request.json();
	} catch {
		error(400, 'Neplatný JSON v požadavku.');
	}

	const latitude = toNumber(body.latitude);
	const longitude = toNumber(body.longitude);
	const accuracy = toNumber(body.accuracy);
	const radiusMeters = toNumber(body.radiusMeters);

	if (latitude === null || longitude === null) {
		error(400, 'Chybí platná latitude nebo longitude.');
	}

	if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
		error(400, 'Souřadnice jsou mimo povolený rozsah.');
	}

	try {
		const result = await findParcelsByGps({
			latitude,
			longitude,
			accuracy,
			radiusMeters
		});

		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Nepodařilo se zavolat katastrální API.';
		error(500, message);
	}
};