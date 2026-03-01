import { SetMetadata } from '@nestjs/common';

export const USAGE_METRIC_KEY = 'usage_metric';
export const UsageMetric = (metric: string) => SetMetadata(USAGE_METRIC_KEY, metric);
