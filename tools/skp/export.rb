# Spatial Archive: open a SketchUp model, export it for the browser, then quit.
# Launched by tools/skp/convert.js as:
#   SketchUp.exe -RubyStartup export.rb <bootstrap template .skp>
# Opening a template on the command line skips the Welcome screen. The real model is then
# opened through the API with `with_status: true`, which reports version differences as a
# status code instead of a blocking dialog. Paths come from environment variables.
module SpatialArchiveExport
  OPTIONS = {
    triangulated_faces: true,
    # One copy of each face: the app draws models double-sided, and duplicated back faces
    # would show their triangulation as edges in the white model.
    doublesided_faces: false,
    edges: false,
    author_attribution: false,
    texture_maps: true,
    selectionset_only: false,
    preserve_instancing: true,
    show_summary: false,
  }.freeze

  def self.report(message)
    File.write(ENV['SA_SKP_STATUS'], message)
  rescue StandardError
    nil
  end

  def self.run
    input = ENV['SA_SKP_INPUT']
    output = ENV['SA_SKP_OUTPUT']
    # Discard the bootstrap template so opening the model cannot prompt to save it.
    Sketchup.active_model.close(true)
    status = Sketchup.open_file(input, with_status: true)
    exported = Sketchup.active_model.export(output, OPTIONS)
    report(exported ? "ok #{status} #{output}" : "export-failed #{status}")
  rescue StandardError => e
    report("error #{e.class}: #{e.message}")
  ensure
    Sketchup.active_model.close(true) rescue nil
    Sketchup.quit
  end
end

File.write("#{ENV['SA_SKP_STATUS']}.loaded", 'loaded') rescue nil
UI.start_timer(1.5, false) { SpatialArchiveExport.run }
