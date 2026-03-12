/**
 * Pagination Utilities
 *
 * Provides helpers for parsing pagination query params and building
 * paginated API responses. Without pagination, list endpoints will
 * crash at 5K+ records.
 */

export function parsePagination(query: any, defaultLimit = 50, maxLimit = 200) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function paginatedResponse<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
}
