export type IntelCategory = 'political' | 'personal' | 'threat' | 'location' | 'rumor';

export interface IntelEntry {
  id:          string;
  label:       string;
  description: string;
  category:    IntelCategory;
}
