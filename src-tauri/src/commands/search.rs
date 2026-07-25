fn strip_html_tags(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(c),
            _ => {}
        }
    }
    result
}

#[tauri::command]
pub fn web_search(query: String) -> Result<String, String> {
    use html_escape::decode_html_entities;
    let url = format!(
        "https://www.bing.com/search?q={}&setlang=zh-CN",
        urlencoding::encode(&query)
    );
    let resp = ureq::get(&url)
        .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| format!("搜索请求失败: {}", e))?;
    let html = resp.into_string().map_err(|e| format!("读取响应失败: {}", e))?;

    let mut results: Vec<(String, String, String)> = Vec::new();

    let start_pos = match html.find(r#"id="b_results""#) {
        Some(i) => i,
        None => return Ok("未找到相关搜索结果。".to_string()),
    };

    let mut pos = start_pos;
    while let Some(idx) = html[pos..].find(r#"<li class="b_algo""#) {
        let li_start = pos + idx;
        let li_tag_end = match html[li_start..].find('>') {
            Some(i) => li_start + i + 1,
            None => { pos = li_start + 20; continue; }
        };
        let next_li = html[li_tag_end..]
            .find(r#"<li class="b_algo""#)
            .map_or(html.len(), |i| li_tag_end + i);
        let chunk = &html[li_tag_end..next_li];
        pos = next_li;

        let (title, link) = if let Some(h2_start) = chunk.find("<h2") {
            let h2_end = match chunk[h2_start..].find("</h2>") {
                Some(i) => h2_start + i,
                None => { continue; }
            };
            let h2_html = &chunk[h2_start..h2_end];
            if let Some(a_start) = h2_html.find("<a") {
                let href = if let Some(href_idx) = h2_html[a_start..].find(r#"href=""#) {
                    let href_val_start = a_start + href_idx + 6;
                    let href_val_end = match h2_html[href_val_start..].find('"') {
                        Some(i) => href_val_start + i,
                        None => { continue; }
                    };
                    h2_html[href_val_start..href_val_end].to_string()
                } else {
                    continue;
                };
                let a_text = if let Some(a_open_end) = h2_html[a_start..].find('>') {
                    let text_start = a_start + a_open_end + 1;
                    let text_end = match h2_html[text_start..].find("</a>") {
                        Some(i) => text_start + i,
                        None => { continue; }
                    };
                    let raw = &h2_html[text_start..text_end];
                    let cleaned = strip_html_tags(raw);
                    decode_html_entities(&cleaned).to_string()
                } else {
                    continue;
                };
                (a_text, href)
            } else {
                continue;
            }
        } else {
            continue;
        };

        let snippet = if let Some(cap_start) = chunk.find(r#"class="b_caption""#) {
            let cap_tag_start = match chunk[..cap_start].rfind('<') {
                Some(i) => i,
                None => continue,
            };
            let cap_chunk = &chunk[cap_tag_start..];
            if let Some(p_start) = cap_chunk.find("<p") {
                let p_open_end = match cap_chunk[p_start..].find('>') {
                    Some(i) => p_start + i + 1,
                    None => continue,
                };
                let p_end = match cap_chunk[p_open_end..].find("</p>") {
                    Some(i) => p_open_end + i,
                    None => cap_chunk.len(),
                };
                let raw = &cap_chunk[p_open_end..p_end];
                let cleaned = strip_html_tags(raw);
                decode_html_entities(&cleaned).to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        results.push((title, link, snippet));
        if results.len() >= 10 { break; }
    }

    if results.is_empty() {
        return Ok("未找到相关搜索结果。".to_string());
    }

    let mut output = String::new();
    output.push_str(&format!("搜索关键词: {}\n\n", query));
    for (i, (title, link, snippet)) in results.iter().enumerate() {
        output.push_str(&format!("{}. {}\n", i + 1, title));
        if !snippet.is_empty() {
            output.push_str(&format!("   {}\n", snippet));
        }
        output.push_str(&format!("   {}\n\n", link));
    }

    Ok(output)
}
