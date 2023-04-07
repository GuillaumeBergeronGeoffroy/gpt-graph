let neo4jJson = {
  "nodes":[
  {"id":0,"labels":["Concept"],"properties":{"name":"Activity/Action","description":"An activity or action is a system of human 'doing' or intentional behavior, whereby a subject or agent works on an object in order to obtain a desired outcome or achieve goals in a particular situation."}},
  {"id":1,"labels":["Concept"],"properties":{"name":"Subject/Agent","description":"The subject or agent is the person or entity performing the activity or action."}},
  {"id":2,"labels":["Concept"],"properties":{"name":"Object","description":"The object is the thing or idea being acted upon."}},
  {"id":3,"labels":["Concept"],"properties":{"name":"Tool","description":"The tool is the instrument used to perform the activity."}},
  {"id":4,"labels":["Concept"],"properties":{"name":"Outcome/Intention","description":"The outcome or intention is the result of the activity or the agent's aims and goals."}},
  {"id":5,"labels":["Concept"],"properties":{"name":"Beliefs and Desires","description":"Beliefs and desires are typically used to explain action."}},
  {"id":6,"labels":["Concept"],"properties":{"name":"Efficient Cause","description":"Efficient cause is the agent who causes the action."}},
  {"id":7,"labels":["Concept"],"properties":{"name":"Final Cause","description":"Final cause is the intention of the action."}},
  {"id":8,"labels":["Concept"],"properties":{"name":"Rationality","description":"Rationality is the ability to respond to reasons and calculate the best means to achieve goals."}},
  {"id":9,"labels":["Concept"],"properties":{"name":"Free Will","description":"Free will is the ability to choose one's own actions."}},
  {"id":10,"labels":["Concept"],"properties":{"name":"Bodily Movements","description":"Bodily movements are physical movements of the body."}}
  ],
  "relationships":[
  {"id":0,"startNodeId":0,"endNodeId":1,"type":"INVOLVES","properties":{}},
  {"id":1,"startNodeId":0,"endNodeId":2,"type":"ACT_ON","properties":{}},
  {"id":2,"startNodeId":0,"endNodeId":3,"type":"USES","properties":{}},
  {"id":3,"startNodeId":0,"endNodeId":4,"type":"ACHIEVE","properties":{}},
  {"id":4,"startNodeId":0,"endNodeId":5,"type":"EXPLAINED_BY","properties":{}},
  {"id":5,"startNodeId":4,"endNodeId":7,"type":"IS_FINAL_CAUSE","properties":{}},
  {"id":6,"startNodeId":1,"endNodeId":6,"type":"CAUSES_ACTION","properties":{}},
  {"id":7,"startNodeId":5,"endNodeId":8,"type":"CONTRIBUTES_TO","properties":{}},
  {"id":8,"startNodeId":4,"endNodeId":9,"type":"RELATED_TO","properties":{}},
  {"id":9,"startNodeId":0,"endNodeId":10,"type":"INVOLVES","properties":{}}
  ]
};

function renderGraph(neo4jJson) {
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