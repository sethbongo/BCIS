import { todayInTimeZone, type ISODate, type Permission, type RoleCode } from '@bcis/shared';
import { config } from '../config';
import type { Db } from '../db/client';

export interface Actor {
  id: number;
  username: string;
  fullName: string;
  roles: RoleCode[];
  permissions: Permission[];
  ip: string | null;
}

/** Everything a service needs: the database and who is acting. */
export interface Ctx {
  db: Db;
  actor: Actor;
}

let clockOverride: ISODate | null = null;

/** Business date in the configured timezone. */
export function today(): ISODate {
  return clockOverride ?? todayInTimeZone(config.timeZone);
}

/** Used by seed scripts and tests to build history "as of" a past date. */
export function setBusinessDate(date: ISODate | null): void {
  clockOverride = date;
}

export const can = (actor: Actor, permission: Permission): boolean => actor.permissions.includes(permission);
