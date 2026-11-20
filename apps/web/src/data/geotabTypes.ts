/* Geotab entity shapes used by the web app's own data types. Moved here (Phase H) from the
   legacy API package so the frontend no longer imports legacy backend code.
   Only the fields the frontend actually uses; no field here is a claim about tenant data. */
export type GeotabDevice = { id: string; name?: string; serialNumber?: string };
export type GeotabUser = { id: string; name?: string; firstName?: string; lastName?: string };
export type GeotabTrip = { id?: string; device?: { id: string }; start?: string; stop?: string };
export type GeotabLocation = { device?: { id: string }; dateTime?: string; latitude?: number; longitude?: number };
