use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub template: String,
    pub enabled: bool,
    pub category: PromptCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PromptCategory {
    Summarization,
    Formatting,
    Extraction,
    Analysis,
    Custom,
}

impl PromptTemplate {
    pub fn render(&self, transcript: &str) -> String {
        self.template.replace("{transcript}", transcript)
    }
}

pub struct PromptManager {
    templates: HashMap<String, PromptTemplate>,
}

impl PromptManager {
    pub fn new() -> Self {
        let mut manager = Self {
            templates: HashMap::new(),
        };
        manager.load_default_templates();
        manager
    }

    fn load_default_templates(&mut self) {
        let default_templates = vec![
            PromptTemplate {
                id: "summarize".to_string(),
                name: "Summarize".to_string(),
                description: "Create a concise summary of the transcript".to_string(),
                template: "Please provide a concise summary of the following transcript in 2-3 sentences:\n\n{transcript}".to_string(),
                enabled: true,
                category: PromptCategory::Summarization,
            },
            PromptTemplate {
                id: "bullet_points".to_string(),
                name: "Bullet Points".to_string(),
                description: "Convert transcript to bullet points".to_string(),
                template: "Convert the following transcript into clear bullet points:\n\n{transcript}".to_string(),
                enabled: true,
                category: PromptCategory::Formatting,
            },
            PromptTemplate {
                id: "action_items".to_string(),
                name: "Extract Action Items".to_string(),
                description: "Extract actionable tasks from the transcript".to_string(),
                template: "Extract all action items and tasks from the following transcript. List each one as a checkbox:\n\n{transcript}".to_string(),
                enabled: true,
                category: PromptCategory::Extraction,
            },
            PromptTemplate {
                id: "fix_grammar".to_string(),
                name: "Fix Grammar".to_string(),
                description: "Correct grammar and punctuation errors".to_string(),
                template: "Please correct any grammar, spelling, and punctuation errors in the following transcript while preserving the original meaning:\n\n{transcript}".to_string(),
                enabled: true,
                category: PromptCategory::Formatting,
            },
            PromptTemplate {
                id: "meeting_notes".to_string(),
                name: "Meeting Notes".to_string(),
                description: "Format as structured meeting notes".to_string(),
                template: "Format the following transcript as structured meeting notes with sections for: Key Topics, Decisions Made, Action Items, and Next Steps:\n\n{transcript}".to_string(),
                enabled: false,
                category: PromptCategory::Formatting,
            },
            PromptTemplate {
                id: "key_points".to_string(),
                name: "Key Points".to_string(),
                description: "Extract the most important points".to_string(),
                template: "Identify and list the 3-5 most important points from the following transcript:\n\n{transcript}".to_string(),
                enabled: false,
                category: PromptCategory::Extraction,
            },
        ];

        for template in default_templates {
            self.templates.insert(template.id.clone(), template);
        }
    }

    pub fn get_template(&self, id: &str) -> Option<&PromptTemplate> {
        self.templates.get(id)
    }

    pub fn get_enabled_templates(&self) -> Vec<&PromptTemplate> {
        self.templates.values().filter(|t| t.enabled).collect()
    }

    pub fn get_all_templates(&self) -> Vec<&PromptTemplate> {
        self.templates.values().collect()
    }

    pub fn add_custom_template(&mut self, template: PromptTemplate) -> Result<(), String> {
        if self.templates.contains_key(&template.id) {
            return Err("Template with this ID already exists".to_string());
        }
        self.templates.insert(template.id.clone(), template);
        Ok(())
    }

    pub fn update_template(&mut self, id: &str, template: PromptTemplate) -> Result<(), String> {
        if !self.templates.contains_key(id) {
            return Err("Template not found".to_string());
        }
        self.templates.insert(id.to_string(), template);
        Ok(())
    }

    pub fn toggle_template(&mut self, id: &str) -> Result<(), String> {
        match self.templates.get_mut(id) {
            Some(template) => {
                template.enabled = !template.enabled;
                Ok(())
            }
            None => Err("Template not found".to_string()),
        }
    }

    pub fn delete_custom_template(&mut self, id: &str) -> Result<(), String> {
        // Only allow deletion of custom templates
        if let Some(template) = self.templates.get(id) {
            if template.category == PromptCategory::Custom {
                self.templates.remove(id);
                Ok(())
            } else {
                Err("Cannot delete built-in templates".to_string())
            }
        } else {
            Err("Template not found".to_string())
        }
    }
}
