function renderGraph(neo4jJson) {
  neo4jJson = JSON.parse(JSON.stringify(neo4jJson));

  // Remove any existing graph before rendering
  d3.select("#graph").selectAll("svg").remove();
  const svg = d3.select("#graph")
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%");

    const width = parseInt(svg.style("width"));
    const height = parseInt(svg.style("height"));

    const simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, 0));

    neo4jJson.relationships.forEach(link => {
      link.source = neo4jJson.nodes.find(node => node.id === link.startNodeId);
      link.target = neo4jJson.nodes.find(node => node.id === link.endNodeId);
    });

    const link = svg.append("g")
      .selectAll("line")
      .data(neo4jJson.relationships)
      .join("line")
      .attr("stroke", "white")
      .attr("stroke-width", 1);

    const node = svg.append("g")
      .selectAll("circle")
      .data(neo4jJson.nodes)
      .join("circle")
      .attr("r", 20)
      .attr("fill", "purple")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    const text = svg.append("g")
      .selectAll("text")
      .data(neo4jJson.nodes)
      .join("text")
      .style('fill', 'white')
      .attr("font-family", "Arial")
      .attr("font-size", "12px")
      .attr("text-anchor", "middle")
      .attr("dy", "0.3em")
      .text(d => d.properties.name);

    simulation.nodes(neo4jJson.nodes).on("tick", ticked);
    simulation.force("link").links(neo4jJson.relationships);

    function ticked() {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);

      text
        .attr("x", d => d.x)
        .attr("y", d => d.y);
    }

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    node.call(d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended));
}