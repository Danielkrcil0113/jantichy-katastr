export type GeoPosition = {
	latitude: number;
	longitude: number;
	accuracy: number | null;
	timestamp: number;
};

export type CuzkApiMode = 'real' | 'mock';

export type ParcelCandidate = {
	id: string;
	parcelNumber: string;
	typParcely: string | null;
	druhCislovaniParcely: string | number | null;
	katastralniUzemiKod: number | null;
	katastralniUzemiNazev: string;
	vymera: number | null;
	lv: string | null;
	druhPozemku: string | null;
	zpusobVyuziti: string | null;
	definicniBodX: number | null;
	definicniBodY: number | null;
	source: CuzkApiMode;
	raw: unknown;
};

export type ParcelLookupResponse = {
	mode: CuzkApiMode;
	center: {
		latitude: number;
		longitude: number;
		sjtskX: number | null;
		sjtskY: number | null;
	};
	searchRadiusMeters: number;
	parcels: ParcelCandidate[];
	messages: string[];
	aktualnostDatK: string | null;
	provedenoVolani: number | null;
	warning: string | null;
};

export type LetterDraftData = {
	recipientName: string;
	recipientAddress: string;
	buyerName: string;
	buyerAddress: string;
	buyerEmail: string;
	buyerPhone: string;
	offerAmount: string;
	customMessage: string;
};