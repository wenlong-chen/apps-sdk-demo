export interface WidgetDefinition {
  name: string;
  description: string;
  fragment: string;
  csp: {
    resource_domains: string[];
    connect_domains: string[];
  };
}

export interface WidgetManifestFile {
  generatedAt: string;
  widgets: WidgetDefinition[];
}
