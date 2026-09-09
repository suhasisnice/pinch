/**
 * Public database surface. Screens and math modules import from here rather
 * than reaching into individual repositories, so the storage layout stays free
 * to change behind one import path.
 */
export { initDatabase, getAdapter, isInitialized, __resetDatabaseForTests } from './connection';

export * from './repos/transactions';
export * from './repos/ious';
export * from './repos/goals';
export * from './repos/outings';
export * from './repos/capture';
export * from './repos/notifications';
export * from './repos/budget';
export * from './repos/maintenance';
